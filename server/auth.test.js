'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const { SettingsStore } = require('./settingsStore');
const { AuthService, createAuthRouter } = require('./auth');

async function createTestApi(t, mailer = null) {
  const store = new SettingsStore(':memory:');
  const auth = new AuthService({ store, mailer, env: { ...process.env, NODE_ENV: 'test', ALLOWED_ORIGINS: 'http://127.0.0.1:5173' } });
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createAuthRouter(auth));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(route, body, cookie, method) {
    const response = await fetch(`${base}${route}`, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: { Origin: 'http://127.0.0.1:5173', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = response.status === 204 ? '' : await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    return { response, data, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
  }
  return { store, auth, request };
}

test('registration does not create pending accounts without configured email delivery', async t => {
  const api = await createTestApi(t);
  const result = await api.request('/auth/register', { displayName: 'Alpha User', nickname: 'alpha_user', email: 'alpha@example.test', password: 'a-long-secure-password' });
  assert.equal(result.response.status, 503);
  assert.equal(api.store.database.prepare('SELECT count(*) AS total FROM users').get().total, 0);
  assert.equal(api.store.database.prepare('SELECT count(*) AS total FROM pending_signups').get().total, 0);
});

test('production session cookies support the separate Vercel frontend', () => {
  const store = new SettingsStore(':memory:');
  const auth = new AuthService({ store, env: { NODE_ENV: 'production' } });
  const responseHeaders = {};
  const now = new Date().toISOString();
  store.database.prepare(`INSERT INTO users
    (id,display_name,nickname,email_normalized,password_hash,email_verified_at,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'active',?,?)`)
    .run('user-1','Test User','test_user','test@example.test','hash',now,now,now);
  auth.issueSession(
    { id: 'user-1' },
    { get: () => 'test-agent' },
    { setHeader: (name, value) => { responseHeaders[name] = value; } }
  );
  assert.match(responseHeaders['Set-Cookie'], /SameSite=None/);
  assert.match(responseHeaders['Set-Cookie'], /; Secure/);
  store.close();
});

test('email verification, login, session, preferences, and private conversation membership work', async t => {
  const sentCodes = new Map();
  const mailer = {
    async sendVerification(email, code) { sentCodes.set(email, code); },
    async sendPasswordReset(email, token) { sentCodes.set(email, token); }
  };
  const api = await createTestApi(t, mailer);
  async function registerAndVerify(displayName, nickname, email) {
    const registration = await api.request('/auth/register', { displayName, nickname, email, password: 'a-long-secure-password' });
    assert.equal(registration.response.status, 202);
    assert.equal(api.store.database.prepare('SELECT email_verified_at FROM users WHERE email_normalized=?').get(email.toLowerCase()), undefined);
    const invalidCode = sentCodes.get(email) === '00000000' ? '00000001' : '00000000';
    assert.equal((await api.request('/auth/verify-email', { email, code: invalidCode })).response.status, 400);
    const verified = await api.request('/auth/verify-email', { email, code: sentCodes.get(email) });
    assert.equal(verified.response.status, 201);
    assert.ok(verified.cookie?.startsWith('linko_session='));
    return verified.cookie;
  }

  const alphaCookie = await registerAndVerify('Alpha User', 'alpha_user', 'alpha@example.test');
  const betaCookie = await registerAndVerify('Beta User', 'beta_user', 'beta@example.test');
  const outsiderCookie = await registerAndVerify('Other User', 'other_user', 'other@example.test');
  assert.equal((await api.request('/auth/session', undefined, alphaCookie)).response.status, 200);
  const preferences = await api.request('/preferences', undefined, alphaCookie);
  assert.equal(preferences.response.status, 200);
  const saved = await api.request('/preferences', { preferences: { theme: 'gamer', directMessages: false } }, alphaCookie, 'PUT');
  assert.equal(saved.response.status, 200);
  assert.equal((await api.request('/preferences', undefined, alphaCookie)).data.preferences.theme, 'gamer');

  const request = await api.request('/friend-requests', { nickname: 'beta_user' }, alphaCookie);
  assert.equal(request.response.status, 201);
  const accept = await api.request(`/friend-requests/${request.data.id}/accept`, {}, betaCookie);
  assert.equal(accept.response.status, 200, JSON.stringify(accept.data));
  const conversations = await api.request('/conversations', undefined, alphaCookie);
  const conversationId = conversations.data.conversations[0].id;
  assert.equal((await api.request(`/conversations/${conversationId}/messages`, undefined, outsiderCookie)).response.status, 404);
  const message = await api.request(`/conversations/${conversationId}/messages`, { content: 'Mensagem privada' }, alphaCookie);
  assert.equal(message.response.status, 201);
  const inbox = await api.request(`/conversations/${conversationId}/messages`, undefined, betaCookie);
  assert.equal(inbox.data.messages[0].content, 'Mensagem privada');

  const loggedOut = await api.request('/auth/logout', {}, alphaCookie);
  assert.equal(loggedOut.response.status, 204);
  assert.equal((await api.request('/auth/session', undefined, alphaCookie)).response.status, 401);
  const login = await api.request('/auth/login', { email: 'alpha@example.test', password: 'a-long-secure-password', remember: true });
  assert.equal(login.response.status, 200);
  assert.equal((await api.request('/auth/login', { email: 'alpha@example.test', password: 'wrong-password-123' })).response.status, 401);
});
