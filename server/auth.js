'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const express = require('express');
const { readScreenshot } = require('./settingsStore');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'linko_session';
const PASSWORD_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'elegant-light', microphoneId: '', cameraId: '', speakerId: '',
  screenWidth: 2160, frameRate: 144, captureSystemAudio: true, showCursor: true,
  directMessages: true, groupMessages: true, calls: true, invites: true,
  friendRequests: true, friendsOnline: true, joinLeaveSounds: true,
  allowMessages: true, reducedMotion: false
});
const DUMMY_SALT = Buffer.alloc(16, 0x4d).toString('hex');
const DUMMY_HASH = crypto.scryptSync('linko-invalid-login-dummy', Buffer.from(DUMMY_SALT, 'hex'), 64, PASSWORD_PARAMS).toString('hex');

class AuthError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().normalize('NFC').toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, 'invalid_email', 'Informe um e-mail válido.');
  return email;
}

function normalizeNickname(value) {
  const nickname = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9](?:[a-z0-9_]{1,22}[a-z0-9])$/.test(nickname)) {
    throw new AuthError(400, 'invalid_nickname', 'O nickname deve ter 3 a 24 caracteres: letras, números e _ no meio.');
  }
  return nickname;
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) {
    throw new AuthError(400, 'invalid_password', 'A senha deve ter de 12 a 128 caracteres.');
  }
  return value;
}

async function hashSecret(secret, params = PASSWORD_PARAMS) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(secret, salt, 64, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifySecret(secret, encoded) {
  try {
    const [algorithm, n, r, p, saltHex, expectedHex] = encoded.split('$');
    if (algorithm !== 'scrypt' || !/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(expectedHex)) return false;
    const N = Number(n), rValue = Number(r), pValue = Number(p);
    if (!Number.isInteger(N) || N < 1 << 14 || N > 1 << 18 || rValue !== 8 || pValue !== 1) return false;
    const derived = await scrypt(secret, Buffer.from(saltHex, 'hex'), 64, { N, r: rValue, p: pValue, maxmem: 256 * 1024 * 1024 });
    return crypto.timingSafeEqual(derived, Buffer.from(expectedHex, 'hex'));
  } catch {
    return false;
  }
}

function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function parseCookies(header = '') {
  const result = Object.create(null);
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    try { result[name] = decodeURIComponent(part.slice(index + 1).trim()); } catch {}
  }
  return result;
}
function dateAfter(milliseconds) { return new Date(Date.now() + milliseconds).toISOString(); }
function publicUser(row) {
  return { id: row.id, displayName: row.display_name, nickname: row.nickname, email: row.email_normalized, emailVerified: Boolean(row.email_verified_at), createdAt: row.created_at };
}
function safeString(value, maxLength, field, { min = 0 } = {}) {
  const text = typeof value === 'string' ? value.trim().normalize('NFC') : '';
  if (text.length < min || text.length > maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new AuthError(400, `invalid_${field}`, `O campo ${field} deve ter de ${min} a ${maxLength} caracteres válidos.`);
  }
  return text;
}

class AuthService {
  constructor({ store, mailer, env = process.env, filesDirectory = path.join(__dirname, 'data', 'files'), allowedOrigins } = {}) {
    if (!store?.database) throw new Error('SettingsStore é obrigatório.');
    this.store = store;
    this.db = store.database;
    this.mailer = mailer || null;
    this.env = env;
    this.filesDirectory = filesDirectory;
    this.allowedOrigins = new Set((allowedOrigins || env.ALLOWED_ORIGINS || [
      'http://localhost:3000', 'http://127.0.0.1:3000',
      'http://localhost:5173', 'http://localhost:5174',
      'http://127.0.0.1:5173', 'http://127.0.0.1:5174'
    ].join(',')).split(',').map(origin => origin.trim()).filter(Boolean));
  }

  consumeLimit(kind, identity, limit, windowMs) {
    const key = crypto.createHmac('sha256', this.env.AUTH_RATE_LIMIT_KEY || 'linko-local-rate-limit')
      .update(`${kind}:${identity}`).digest('hex');
    const now = Date.now();
    this.db.prepare('DELETE FROM auth_rate_limits WHERE window_started_at < ?')
      .run(new Date(now - 24 * 60 * 60 * 1000).toISOString());
    const row = this.db.prepare('SELECT attempts, window_started_at, blocked_until FROM auth_rate_limits WHERE rate_key = ?').get(key);
    if (!row || now - Date.parse(row.window_started_at) >= windowMs) {
      this.db.prepare(`INSERT INTO auth_rate_limits (rate_key, attempts, window_started_at, blocked_until)
        VALUES (?, 1, ?, NULL) ON CONFLICT(rate_key) DO UPDATE SET attempts=1, window_started_at=excluded.window_started_at, blocked_until=NULL`)
        .run(key, new Date(now).toISOString());
      return true;
    }
    if (row.blocked_until && Date.parse(row.blocked_until) > now) return false;
    if (row.attempts >= limit) {
      this.db.prepare('UPDATE auth_rate_limits SET blocked_until = ? WHERE rate_key = ?')
        .run(dateAfter(windowMs), key);
      return false;
    }
    this.db.prepare('UPDATE auth_rate_limits SET attempts = attempts + 1 WHERE rate_key = ?').run(key);
    return true;
  }

  getUserForToken(token) {
    if (!token || token.length < 40 || token.length > 100) return null;
    const row = this.db.prepare(`SELECT u.* FROM user_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`).get(tokenHash(token), new Date().toISOString());
    if (!row) return null;
    this.db.prepare('UPDATE user_sessions SET last_seen_at=? WHERE token_hash=?')
      .run(new Date().toISOString(), tokenHash(token));
    return row;
  }

  getRequestUser(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    return this.getUserForToken(token);
  }

  getSocketUser(cookieHeader) {
    return this.getUserForToken(parseCookies(cookieHeader)[SESSION_COOKIE]);
  }

  requireAuth(req, res, next) {
    const user = this.getRequestUser(req);
    if (!user) return res.status(401).json({ error: { code: 'session_required', message: 'Entre na sua conta para continuar.' } });
    req.user = publicUser(user);
    next();
  }

  issueSession(user, req, res, remember = true) {
    const token = crypto.randomBytes(32).toString('base64url');
    const ttlDays = remember ? Math.min(90, Math.max(1, Number(this.env.SESSION_TTL_DAYS) || 30)) : 1;
    const expiresAt = dateAfter(ttlDays * 24 * 60 * 60 * 1000);
    const createdAt = new Date().toISOString();
    this.db.prepare(`INSERT INTO user_sessions (token_hash,user_id,created_at,last_seen_at,expires_at,user_agent)
      VALUES (?,?,?,?,?,?)`).run(tokenHash(token), user.id, createdAt, createdAt, expiresAt,
      String(req.get('user-agent') || '').slice(0, 300));
    const secure = this.env.NODE_ENV === 'production' ? '; Secure' : '';
    const sameSite = secure ? 'None' : 'Lax';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${ttlDays * 86400}${secure}`);
  }

  clearCookie(res) {
    const secure = this.env.NODE_ENV === 'production' ? '; Secure' : '';
    const sameSite = secure ? 'None' : 'Lax';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=0${secure}`);
  }

  isConversationMember(conversationId, userId) {
    return Boolean(this.db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?').get(conversationId, userId));
  }
}

function createAuthRouter(auth, { io } = {}) {
  const router = express.Router();
  const { db } = auth;
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && !auth.allowedOrigins.has(origin)) return res.status(403).json({ error: { code: 'origin_denied', message: 'Origem não permitida.' } });
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.set('Vary', 'Origin');
    }
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && !origin) {
      return res.status(403).json({ error: { code: 'origin_required', message: 'Origem não permitida.' } });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  router.get('/auth/session', (req, res) => {
    const row = auth.getRequestUser(req);
    if (!row) return res.status(401).json({ error: { code: 'session_required', message: 'Entre na sua conta.' } });
    return res.json({ user: publicUser(row) });
  });

  router.post('/auth/register', async (req, res) => {
    let email, nickname, displayName, password;
    try {
      email = normalizeEmail(req.body?.email);
      nickname = normalizeNickname(req.body?.nickname);
      displayName = safeString(req.body?.displayName, 32, 'display_name', { min: 1 });
      password = validatePassword(req.body?.password);
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 400;
      return res.status(status).json({ error: { code: error.code || 'invalid_registration', message: error.message } });
    }
    const address = req.socket.remoteAddress || 'unknown';
    if (!auth.consumeLimit('register', address, 5, 60 * 60 * 1000) || !auth.consumeLimit('register-email', email, 3, 60 * 60 * 1000)) {
      return res.status(429).json({ error: { code: 'rate_limited', message: 'Muitas tentativas. Tente novamente mais tarde.' } });
    }
    const existingEmail = db.prepare('SELECT 1 FROM users WHERE email_normalized=?').get(email);
    const existingNickname = db.prepare('SELECT 1 FROM users WHERE nickname=? COLLATE NOCASE').get(nickname);
    if (existingEmail || existingNickname) return res.status(409).json({ error: { code: 'registration_unavailable', message: 'Não foi possível usar esses dados. Verifique o e-mail/nickname ou entre na conta existente.' } });
    const passwordHash = await hashSecret(password);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare(`INSERT INTO users (id,display_name,nickname,email_normalized,password_hash,email_registered_at,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'active',?,?)`).run(id,displayName,nickname,email,passwordHash,now,now,now);
      db.prepare('INSERT INTO user_profiles (user_id,updated_at) VALUES (?,?)').run(id,now);
      db.prepare('INSERT INTO user_preferences (user_id,preferences_json,updated_at) VALUES (?,?,?)').run(id,JSON.stringify(DEFAULT_PREFERENCES),now);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (error.errcode !== 2067 && error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
      return res.status(409).json({ error: { code: 'registration_unavailable', message: 'Não foi possível usar esses dados. Verifique o e-mail/nickname ou entre na conta existente.' } });
    }
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    auth.issueSession(user, req, res, true);
    return res.status(201).json({ user: publicUser(user) });
  });

  router.post('/auth/login', async (req, res) => {
    let email;
    try { email = normalizeEmail(req.body?.email); validatePassword(req.body?.password); } catch { return res.status(400).json({ error: { code: 'invalid_credentials', message: 'E-mail ou senha inválidos.' } }); }
    const identity = `${req.socket.remoteAddress}:${email}`;
    if (!auth.consumeLimit('login', identity, 8, 15 * 60 * 1000)) return res.status(429).json({ error: { code: 'rate_limited', message: 'Muitas tentativas. Tente novamente mais tarde.' } });
    const user = db.prepare('SELECT * FROM users WHERE email_normalized=?').get(email);
    const passwordMatches = await verifySecret(req.body.password, user?.password_hash || DUMMY_HASH);
    if (!user || !passwordMatches || user.status !== 'active') return res.status(401).json({ error: { code: 'invalid_credentials', message: 'E-mail ou senha inválidos.' } });
    const remember = req.body?.remember !== false;
    auth.issueSession(user, req, res, remember);
    return res.json({ user: publicUser(user) });
  });

  router.post('/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const user = auth.getUserForToken(token);
    if (token) db.prepare('DELETE FROM user_sessions WHERE token_hash=?').run(tokenHash(token));
    auth.clearCookie(res);
    if (user && io) io.in(`user:${user.id}`).disconnectSockets(true);
    return res.status(204).end();
  });

  router.post('/auth/request-password-reset', async (req, res) => {
    let email;
    try { email = normalizeEmail(req.body?.email); } catch { return res.status(202).json({ message: 'Se a conta existir, enviaremos instruções de recuperação.' }); }
    if (!auth.mailer) return res.status(503).json({ error: { code: 'email_unconfigured', message: 'A recuperação exige SMTP configurado.' } });
    if (!auth.consumeLimit('reset-request', `${req.socket.remoteAddress}:${email}`, 3, 60 * 60 * 1000)) return res.status(429).json({ error: { code: 'rate_limited', message: 'Muitas solicitações. Tente novamente mais tarde.' } });
    const user = db.prepare("SELECT * FROM users WHERE email_normalized=? AND status='active'").get(email);
    if (!user) return res.status(202).json({ message: 'Se a conta existir, enviaremos instruções de recuperação.' });
    const token = crypto.randomBytes(32).toString('base64url');
    const challengeId = crypto.randomUUID();
    db.prepare('DELETE FROM password_reset_challenges WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO password_reset_challenges (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)')
      .run(challengeId,user.id,tokenHash(token),dateAfter(30 * 60 * 1000),new Date().toISOString());
    try { await auth.mailer.sendPasswordReset(email, token); } catch {
      db.prepare('DELETE FROM password_reset_challenges WHERE id=?').run(challengeId);
      return res.status(503).json({ error: { code: 'email_delivery_failed', message: 'Não foi possível enviar as instruções agora.' } });
    }
    return res.status(202).json({ message: 'Se a conta existir, enviaremos instruções de recuperação.' });
  });

  router.post('/auth/reset-password', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    let password;
    try { password = validatePassword(req.body?.password); } catch (error) { return res.status(400).json({ error: { code: error.code, message: error.message } }); }
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return res.status(400).json({ error: { code: 'invalid_reset', message: 'O link de recuperação é inválido ou expirou.' } });
    const challenge = db.prepare('SELECT * FROM password_reset_challenges WHERE token_hash=?').get(tokenHash(token));
    if (!challenge || Date.parse(challenge.expires_at) <= Date.now()) {
      if (challenge) db.prepare('DELETE FROM password_reset_challenges WHERE id=?').run(challenge.id);
      return res.status(400).json({ error: { code: 'invalid_reset', message: 'O link de recuperação é inválido ou expirou.' } });
    }
    const passwordHash = await hashSecret(password);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE users SET password_hash=?,updated_at=? WHERE id=?').run(passwordHash,new Date().toISOString(),challenge.user_id);
      db.prepare('DELETE FROM user_sessions WHERE user_id=?').run(challenge.user_id);
      db.prepare('DELETE FROM password_reset_challenges WHERE user_id=?').run(challenge.user_id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    auth.clearCookie(res);
    if (io) io.in(`user:${challenge.user_id}`).disconnectSockets(true);
    return res.json({ status: 'password_updated', message: 'Senha alterada. Entre novamente.' });
  });

  router.put('/profile/files/:kind', auth.requireAuth.bind(auth), (req, res) => {
    if (!['avatar','cover'].includes(req.params.kind)) return res.status(404).json({ error: { code: 'file_type_not_found', message: 'Tipo de arquivo inválido.' } });
    let image;
    try { image = readScreenshot(req.body?.image); } catch (error) { return res.status(400).json({ error: { code: 'invalid_image', message: error.message } }); }
    if (!image.bytes || image.bytes.length > 700 * 1024) return res.status(400).json({ error: { code: 'invalid_image_size', message: 'A imagem deve ter até 700 KB.' } });
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[image.mime];
    const storageName = `${crypto.randomUUID()}.${extension}`;
    fs.mkdirSync(auth.filesDirectory, { recursive: true, mode: 0o700 });
    const filePath = path.join(auth.filesDirectory, storageName);
    const now = new Date().toISOString();
    const column = req.params.kind === 'avatar' ? 'avatar_file_id' : 'cover_file_id';
    let oldFile = null;
    try {
      fs.writeFileSync(filePath,image.bytes,{flag:'wx',mode:0o600});
      const old = db.prepare(`SELECT f.id,f.storage_name FROM user_profiles p LEFT JOIN stored_files f ON f.id=p.${column} WHERE p.user_id=?`).get(req.user.id);
      oldFile = old?.storage_name || null;
      const fileId = crypto.randomUUID();
      db.exec('BEGIN IMMEDIATE');
      db.prepare('INSERT INTO stored_files (id,user_id,storage_name,mime_type,byte_size,created_at) VALUES (?,?,?,?,?,?)').run(fileId,req.user.id,storageName,image.mime,image.bytes.length,now);
      db.prepare(`UPDATE user_profiles SET ${column}=?,updated_at=? WHERE user_id=?`).run(fileId,now,req.user.id);
      if (old?.id) db.prepare('DELETE FROM stored_files WHERE id=? AND user_id=?').run(old.id,req.user.id);
      db.exec('COMMIT');
      if (oldFile) { try { fs.unlinkSync(path.join(auth.filesDirectory,oldFile)); } catch {} }
      return res.status(201).json({ id:fileId,url:`/api/profile/files/${fileId}` });
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      try { fs.unlinkSync(filePath); } catch {}
      console.error('Profile image upload failed:',error.message);
      return res.status(500).json({ error: { code:'upload_failed',message:'Não foi possível salvar a imagem.' } });
    }
  });

  router.get('/profile/files/:id', auth.requireAuth.bind(auth), (req, res) => {
    const file = db.prepare('SELECT storage_name,mime_type FROM stored_files WHERE id=? AND user_id=?').get(req.params.id,req.user.id);
    if (!file) return res.status(404).json({ error: { code:'file_not_found',message:'Arquivo não encontrado.' } });
    const filePath = path.join(auth.filesDirectory,file.storage_name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: { code:'file_not_found',message:'Arquivo não encontrado.' } });
    res.set({ 'Content-Type':file.mime_type,'Content-Length':String(fs.statSync(filePath).size),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff' });
    return res.sendFile(filePath);
  });

  router.get('/profile', auth.requireAuth.bind(auth), (req, res) => {
    const row = db.prepare(`SELECT u.id,u.display_name,u.nickname,u.email_normalized,u.email_verified_at,u.created_at,
      p.bio,p.avatar_file_id,p.cover_file_id FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=?`).get(req.user.id);
    if (!row) return res.status(404).json({ error: { code: 'profile_not_found', message: 'Perfil indisponível.' } });
    return res.json({ profile: { ...publicUser({ ...row, status: 'active' }), bio: row.bio, avatarUrl: row.avatar_file_id ? `/api/profile/files/${row.avatar_file_id}` : null, coverUrl: row.cover_file_id ? `/api/profile/files/${row.cover_file_id}` : null } });
  });

  router.patch('/profile', auth.requireAuth.bind(auth), (req, res) => {
    try {
      const displayName = safeString(req.body?.displayName, 32, 'display_name', { min: 1 });
      const nickname = normalizeNickname(req.body?.nickname);
      const bio = safeString(req.body?.bio || '', 280, 'bio');
      const now = new Date().toISOString();
      db.prepare('UPDATE users SET display_name=?,nickname=?,updated_at=? WHERE id=?').run(displayName,nickname,now,req.user.id);
      db.prepare('UPDATE user_profiles SET bio=?,updated_at=? WHERE user_id=?').run(bio,now,req.user.id);
      return res.json({ profile: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)), bio });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: { code: 'nickname_unavailable', message: 'Este nickname já está em uso.' } });
      return res.status(error.status || 400).json({ error: { code: error.code || 'invalid_profile', message: error.message || 'Perfil inválido.' } });
    }
  });

  router.get('/preferences', auth.requireAuth.bind(auth), (req, res) => {
    const row = db.prepare('SELECT preferences_json FROM user_preferences WHERE user_id=?').get(req.user.id);
    let saved = {};
    try { saved = JSON.parse(row?.preferences_json || '{}'); } catch {}
    return res.json({ preferences: { ...DEFAULT_PREFERENCES, ...saved } });
  });

  router.put('/preferences', auth.requireAuth.bind(auth), (req, res) => {
    const patch = req.body?.preferences;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return res.status(400).json({ error: { code: 'invalid_preferences', message: 'Preferências inválidas.' } });
    const updated = { ...DEFAULT_PREFERENCES };
    const existing = db.prepare('SELECT preferences_json FROM user_preferences WHERE user_id=?').get(req.user.id);
    try { Object.assign(updated, JSON.parse(existing?.preferences_json || '{}')); } catch {}
    const booleanKeys = ['captureSystemAudio','showCursor','directMessages','groupMessages','calls','invites','friendRequests','friendsOnline','joinLeaveSounds','allowMessages','reducedMotion'];
    for (const [key, value] of Object.entries(patch)) {
      if (!Object.hasOwn(DEFAULT_PREFERENCES, key)) return res.status(400).json({ error: { code: 'unknown_preference', message: 'Preferência desconhecida.' } });
      if (booleanKeys.includes(key) && typeof value !== 'boolean') return res.status(400).json({ error: { code: 'invalid_preference', message: `Valor inválido para ${key}.` } });
      if (key === 'theme' && !['elegant-light','elegant-dark','gamer'].includes(value)) return res.status(400).json({ error: { code: 'invalid_preference', message: 'Tema inválido.' } });
      if (key === 'screenWidth' && ![1080,1440,2160].includes(value)) return res.status(400).json({ error: { code: 'invalid_preference', message: 'Resolução inválida.' } });
      if (key === 'frameRate' && ![30,60,120,144].includes(value)) return res.status(400).json({ error: { code: 'invalid_preference', message: 'Taxa de quadros inválida.' } });
      if (['microphoneId','cameraId','speakerId'].includes(key) && (typeof value !== 'string' || value.length > 256)) return res.status(400).json({ error: { code: 'invalid_preference', message: 'Dispositivo inválido.' } });
      updated[key] = value;
    }
    db.prepare(`INSERT INTO user_preferences (user_id,preferences_json,updated_at) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at`)
      .run(req.user.id,JSON.stringify(updated),new Date().toISOString());
    return res.json({ preferences: updated });
  });

  router.get('/friends', auth.requireAuth.bind(auth), (req, res) => {
    const friends = db.prepare(`SELECT u.id,u.nickname,u.display_name,
      (SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=?
       JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=u.id WHERE c.kind='dm' LIMIT 1) AS conversation_id
      FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_low_id=? THEN f.user_high_id ELSE f.user_low_id END
      WHERE f.user_low_id=? OR f.user_high_id=? ORDER BY u.nickname`).all(req.user.id,req.user.id,req.user.id,req.user.id);
    return res.json({ friends });
  });

  router.get('/friend-requests', auth.requireAuth.bind(auth), (req, res) => {
    const requests = db.prepare(`SELECT r.id,r.status,r.created_at,u.nickname,u.display_name,
      CASE WHEN r.recipient_user_id=? THEN 'received' ELSE 'sent' END AS direction
      FROM friend_requests r JOIN users u ON u.id=CASE WHEN r.recipient_user_id=? THEN r.sender_user_id ELSE r.recipient_user_id END
      WHERE (r.sender_user_id=? OR r.recipient_user_id=?) AND r.status='pending' ORDER BY r.created_at DESC`).all(req.user.id,req.user.id,req.user.id,req.user.id);
    return res.json({ requests });
  });

  router.post('/friend-requests', auth.requireAuth.bind(auth), (req, res) => {
    let nickname;
    try { nickname = normalizeNickname(req.body?.nickname); } catch (error) { return res.status(400).json({ error: { code: error.code, message: error.message } }); }
    const target = db.prepare("SELECT id FROM users WHERE nickname=? COLLATE NOCASE AND status='active'").get(nickname);
    if (!target || target.id === req.user.id) return res.status(404).json({ error: { code: 'user_unavailable', message: 'Não foi possível encontrar este usuário.' } });
    const [low, high] = [req.user.id,target.id].sort();
    if (db.prepare('SELECT 1 FROM friendships WHERE user_low_id=? AND user_high_id=?').get(low,high)) return res.status(409).json({ error: { code: 'already_friends', message: 'Vocês já são amigos.' } });
    const reverse = db.prepare("SELECT * FROM friend_requests WHERE sender_user_id=? AND recipient_user_id=? AND status='pending'").get(target.id,req.user.id);
    const now = new Date().toISOString();
    if (reverse) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare("UPDATE friend_requests SET status='accepted',updated_at=? WHERE id=?").run(now,reverse.id);
        db.prepare('INSERT OR IGNORE INTO friendships (user_low_id,user_high_id,created_at) VALUES (?,?,?)').run(low,high,now);
        createDirectConversation(db,low,high,now);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return res.status(200).json({ status: 'friends' });
    }
    const id = crypto.randomUUID();
    try { db.prepare(`INSERT INTO friend_requests (id,sender_user_id,recipient_user_id,status,created_at,updated_at) VALUES (?,?,?,'pending',?,?)`).run(id,req.user.id,target.id,now,now); }
    catch { return res.status(409).json({ error: { code: 'request_exists', message: 'Já existe um pedido pendente.' } }); }
    return res.status(201).json({ id, status: 'pending' });
  });

  router.post('/friend-requests/:id/accept', auth.requireAuth.bind(auth), (req, res) => {
    const request = db.prepare("SELECT * FROM friend_requests WHERE id=? AND recipient_user_id=? AND status='pending'").get(req.params.id,req.user.id);
    if (!request) return res.status(404).json({ error: { code: 'request_not_found', message: 'Pedido não encontrado.' } });
    const [low, high] = [request.sender_user_id,request.recipient_user_id].sort();
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE friend_requests SET status='accepted',updated_at=? WHERE id=?").run(now,request.id);
      db.prepare('INSERT OR IGNORE INTO friendships (user_low_id,user_high_id,created_at) VALUES (?,?,?)').run(low,high,now);
      const conversationId = createDirectConversation(db,low,high,now);
      db.exec('COMMIT');
      return res.json({ status: 'accepted', conversationId });
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });

  router.post('/friend-requests/:id/decline', auth.requireAuth.bind(auth), (req, res) => {
    const result = db.prepare("UPDATE friend_requests SET status='declined',updated_at=? WHERE id=? AND recipient_user_id=? AND status='pending'")
      .run(new Date().toISOString(),req.params.id,req.user.id);
    return result.changes ? res.json({ status: 'declined' }) : res.status(404).json({ error: { code: 'request_not_found', message: 'Pedido não encontrado.' } });
  });

  router.delete('/friends/:userId', auth.requireAuth.bind(auth), (req, res) => {
    const [low, high] = [req.user.id,req.params.userId].sort();
    const result = db.prepare('DELETE FROM friendships WHERE user_low_id=? AND user_high_id=?').run(low,high);
    if (!result.changes) return res.status(404).json({ error: { code: 'friend_not_found', message: 'Amizade não encontrada.' } });
    const direct = db.prepare(`SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=? JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=? WHERE c.kind='dm'`).all(low,high);
    const remove = db.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?');
    direct.forEach(row => remove.run(row.id,req.user.id));
    return res.json({ status: 'removed' });
  });

  router.get('/conversations', auth.requireAuth.bind(auth), (req, res) => {
    const conversations = db.prepare(`SELECT c.id,c.kind,c.title,c.created_at,
      (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id=c.id) AS member_count
      FROM conversations c JOIN conversation_members mine ON mine.conversation_id=c.id
      WHERE mine.user_id=? ORDER BY c.created_at DESC`).all(req.user.id);
    return res.json({ conversations });
  });

  router.post('/conversations', auth.requireAuth.bind(auth), (req, res) => {
    const title = safeString(req.body?.title, 80, 'title', { min: 1 });
    const nicknames = Array.isArray(req.body?.members) ? [...new Set(req.body.members.map(normalizeNickname))] : [];
    if (nicknames.length < 2 || nicknames.length > 7) return res.status(400).json({ error: { code: 'invalid_members', message: 'Um grupo precisa ter de 2 a 7 convidados.' } });
    const placeholders = nicknames.map(() => '?').join(',');
    const friendRows = db.prepare(`SELECT u.id,u.nickname FROM users u JOIN friendships f ON (f.user_low_id=? AND f.user_high_id=u.id) OR (f.user_high_id=? AND f.user_low_id=u.id) WHERE u.nickname COLLATE NOCASE IN (${placeholders})`).all(req.user.id,req.user.id,...nicknames);
    if (friendRows.length !== nicknames.length) return res.status(403).json({ error: { code: 'members_not_friends', message: 'Todos os convidados precisam ser seus amigos.' } });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("INSERT INTO conversations (id,kind,title,created_by,created_at) VALUES (?,'group',?,?,?)").run(id,title,req.user.id,now);
      const add = db.prepare("INSERT INTO conversation_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)");
      add.run(id,req.user.id,'owner',now);
      friendRows.forEach(member => add.run(id,member.id,'member',now));
      db.exec('COMMIT');
      return res.status(201).json({ id, kind: 'group', title });
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });

  router.get('/conversations/:id/messages', auth.requireAuth.bind(auth), (req, res) => {
    if (!auth.isConversationMember(req.params.id,req.user.id)) return res.status(404).json({ error: { code: 'conversation_not_found', message: 'Conversa não encontrada.' } });
    const limit = Math.min(100,Math.max(1,Number(req.query.limit) || 50));
    const messages = db.prepare(`SELECT m.id,m.content,m.created_at,u.id AS user_id,u.nickname,u.display_name
      FROM messages m LEFT JOIN users u ON u.id=m.sender_user_id WHERE m.conversation_id=?
      ORDER BY m.created_at DESC LIMIT ?`).all(req.params.id,limit).reverse();
    return res.json({ messages });
  });

  router.post('/conversations/:id/messages', auth.requireAuth.bind(auth), (req, res) => {
    if (!auth.isConversationMember(req.params.id,req.user.id)) return res.status(404).json({ error: { code: 'conversation_not_found', message: 'Conversa não encontrada.' } });
    let content;
    try { content = safeString(req.body?.content,5000,'message',{min:1}); } catch (error) { return res.status(400).json({ error: { code: error.code, message: error.message } }); }
    const message = { id: crypto.randomUUID(), conversationId: req.params.id, content, createdAt: new Date().toISOString(), user: req.user };
    db.prepare('INSERT INTO messages (id,conversation_id,sender_user_id,content,created_at) VALUES (?,?,?,?,?)').run(message.id,message.conversationId,req.user.id,content,message.createdAt);
    if (io) io.to(message.conversationId).emit('chat-message', content, req.user.nickname, { id: message.id, createdAt: message.createdAt });
    return res.status(201).json({ message: { id: message.id, content, createdAt: message.createdAt } });
  });

  router.delete('/account', auth.requireAuth.bind(auth), async (req, res) => {
    const userRow = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!await verifySecret(req.body?.password || '', userRow.password_hash)) return res.status(401).json({ error: { code: 'reauthentication_failed', message: 'Senha inválida.' } });
    const files = db.prepare('SELECT storage_name FROM stored_files WHERE user_id=?').all(req.user.id);
    db.exec('BEGIN IMMEDIATE');
    try { db.prepare('DELETE FROM users WHERE id=?').run(req.user.id); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); return res.status(500).json({ error: { code: 'account_delete_failed', message: 'Não foi possível excluir a conta.' } }); }
    for (const file of files) { try { fs.unlinkSync(path.join(auth.filesDirectory,file.storage_name)); } catch {} }
    auth.clearCookie(res);
    if (io) io.in(`user:${req.user.id}`).disconnectSockets(true);
    return res.json({ status: 'deleted' });
  });

  return router;
}

function createDirectConversation(db, userA, userB, now) {
  const existing = db.prepare(`SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=?
    JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=? WHERE c.kind='dm' LIMIT 1`).get(userA,userB);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO conversations (id,kind,title,created_by,created_at) VALUES (?,'dm','',?,?)").run(id,userA,now);
  const add = db.prepare("INSERT INTO conversation_members (conversation_id,user_id,role,joined_at) VALUES (?,?,'member',?)");
  add.run(id,userA,now);
  add.run(id,userB,now);
  return id;
}

module.exports = { AuthService, AuthError, createAuthRouter, hashSecret, verifySecret, normalizeEmail, normalizeNickname, DEFAULT_PREFERENCES, SESSION_COOKIE, parseCookies, tokenHash };
