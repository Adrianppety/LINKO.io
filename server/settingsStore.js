'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');

const REPORT_TYPES = new Set(['bug', 'feature', 'other']);
const MAX_SCREENSHOT_BYTES = 1024 * 1024;

class ReportValidationError extends Error {}

function readScreenshot(value) {
  if (value == null || value === '') return { mime: null, bytes: null };
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_SCREENSHOT_BYTES * 4 / 3) + 256) {
    throw new ReportValidationError('A captura excede o limite de 1 MB.');
  }
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new ReportValidationError('Use uma imagem PNG, JPG ou WebP válida.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_SCREENSHOT_BYTES) {
    throw new ReportValidationError('A captura excede o limite de 1 MB.');
  }
  const valid = match[1] === 'image/png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : match[1] === 'image/jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new ReportValidationError('O conteúdo da imagem não corresponde ao formato informado.');
  return { mime: match[1], bytes };
}

function validateReport(body, userAgent = '') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ReportValidationError('Dados do relato inválidos.');
  }
  const type = typeof body.type === 'string' ? body.type : '';
  const title = typeof body.title === 'string' ? body.title.trim().normalize('NFC') : '';
  const description = typeof body.description === 'string' ? body.description.trim().normalize('NFC') : '';
  const steps = typeof body.steps === 'string' ? body.steps.trim().normalize('NFC') : '';
  if (!REPORT_TYPES.has(type)) throw new ReportValidationError('Escolha um tipo de relato válido.');
  if (title.length < 4 || title.length > 100) throw new ReportValidationError('O título deve ter de 4 a 100 caracteres.');
  if (description.length < 12 || description.length > 4000) throw new ReportValidationError('A descrição deve ter de 12 a 4.000 caracteres.');
  if (steps.length > 3000) throw new ReportValidationError('Os passos devem ter no máximo 3.000 caracteres.');
  const screenshot = readScreenshot(body.screenshot);
  return {
    id: crypto.randomUUID(),
    type,
    title,
    description,
    steps,
    screenshotMime: screenshot.mime,
    screenshot: screenshot.bytes,
    technicalInfo: JSON.stringify({ userAgent: String(userAgent).slice(0, 300) }),
    createdAt: new Date().toISOString()
  };
}

class SettingsStore {
  constructor(databasePath = path.join(__dirname, 'data', 'linko.sqlite')) {
    if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA foreign_keys = ON; CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
    const applied = new Set(this.database.prepare('SELECT version FROM schema_migrations').all().map(row => row.version));
    const migrationDirectory = path.join(__dirname, 'migrations');
    const migrations = fs.readdirSync(migrationDirectory).filter(file => /^\d+_[a-z0-9_-]+\.sql$/i.test(file)).sort();
    for (const file of migrations) {
      const version = path.basename(file, '.sql');
      if (applied.has(version)) continue;
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.database.exec(fs.readFileSync(path.join(migrationDirectory, file), 'utf8'));
        this.database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    }
    if (databasePath !== ':memory:') {
      try { fs.chmodSync(databasePath, 0o600); } catch {}
    }
  }

  createReport(report, userId = null) {
    this.database.prepare(`
      INSERT INTO bug_reports
        (id, type, title, description, reproduction_steps, screenshot_mime, screenshot, technical_info, created_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(report.id, report.type, report.title, report.description, report.steps,
      report.screenshotMime, report.screenshot, report.technicalInfo, report.createdAt, userId);
    return { id: report.id, status: 'received', createdAt: report.createdAt };
  }

  close() { this.database.close(); }
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin || origin === 'null') return true;
  if (allowedOrigins?.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function createReportsRouter(store, { now = Date.now, limit = 3, windowMs = 60 * 60 * 1000 } = {}, authService = null) {
  const router = express.Router();
  const requests = new Map();
  router.use((req, res, next) => {
    const origin = req.get('origin');
    if (!isAllowedOrigin(origin, authService?.allowedOrigins)) return res.status(403).json({ error: { code: 'origin_denied', message: 'Origem não permitida.' } });
    if (origin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
    }
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  router.post('/', (req, res) => {
    const address = req.socket.remoteAddress || 'unknown';
    const timestamp = now();
    const recent = (requests.get(address) || []).filter(time => timestamp - time < windowMs);
    if (recent.length >= limit) {
      requests.set(address, recent);
      return res.status(429).json({ error: { code: 'rate_limited', message: 'Muitos relatos enviados. Tente novamente mais tarde.' } });
    }
    try {
      const report = validateReport(req.body, req.get('user-agent'));
      const user = authService?.getRequestUser(req);
      const saved = store.createReport(report, user?.id || null);
      recent.push(timestamp);
      requests.set(address, recent);
      return res.status(201).json(saved);
    } catch (error) {
      if (error instanceof ReportValidationError) {
        return res.status(400).json({ error: { code: 'invalid_report', message: error.message } });
      }
      console.error('Report persistence failed:', error.message);
      return res.status(500).json({ error: { code: 'report_unavailable', message: 'Não foi possível salvar o relato.' } });
    }
  });
  return router;
}

module.exports = { SettingsStore, ReportValidationError, validateReport, createReportsRouter, readScreenshot };