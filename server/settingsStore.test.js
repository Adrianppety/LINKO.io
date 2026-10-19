'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { SettingsStore, ReportValidationError, validateReport, createReportsRouter } = require('./settingsStore');

const validReport = { type: 'bug', title: 'Erro ao abrir configurações', description: 'O painel não abriu depois do clique.' };

test('validates report fields and rejects spoofed or invalid image payloads', () => {
  assert.throws(() => validateReport({ ...validReport, type: 'admin' }), ReportValidationError);
  assert.throws(() => validateReport({ ...validReport, title: 'abc' }), ReportValidationError);
  assert.throws(() => validateReport({ ...validReport, screenshot: 'data:image/svg+xml;base64,PHN2Zz4=' }), ReportValidationError);
  assert.throws(() => validateReport({ ...validReport, screenshot: 'data:image/png;base64,AAAA' }), ReportValidationError);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const withScreenshot = validateReport({ ...validReport, screenshot: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(withScreenshot.screenshotMime, 'image/png');
  assert.equal(withScreenshot.screenshot.length, png.length);
  const report = validateReport({ ...validReport, userId: 'other-user' }, 'test-agent');
  assert.equal(report.userId, undefined);
  assert.equal(JSON.parse(report.technicalInfo).userAgent, 'test-agent');
});

test('stores reports in SQLite without exposing their contents in the response', () => {
  const store = new SettingsStore(':memory:');
  const report = validateReport(validReport, 'test-agent');
  const response = store.createReport(report);
  const saved = store.database.prepare('SELECT id, status, title FROM bug_reports').get();
  assert.deepEqual(response, { id: report.id, status: 'received', createdAt: report.createdAt });
  assert.equal(saved.title, validReport.title);
  assert.equal(saved.status, 'new');
  store.close();
});

test('migration is recorded once and preserves reports on database reopen', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linko-settings-'));
  const databasePath = path.join(directory, 'settings.sqlite');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = new SettingsStore(databasePath);
  const report = validateReport(validReport);
  first.createReport(report);
  first.close();
  const second = new SettingsStore(databasePath);
  assert.equal(second.database.prepare('SELECT count(*) AS total FROM schema_migrations').get().total, 2);
  assert.equal(second.database.prepare('SELECT id FROM bug_reports').get().id, report.id);
  second.close();
});

test('report API accepts local clients, rejects remote origins and rate limits submissions', async t => {
  const store = new SettingsStore(':memory:');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/reports', createReportsRouter(store, { limit: 1 }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); store.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/reports`;
  const post = origin => fetch(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(validReport) });
  const accepted = await post('null');
  assert.equal(accepted.status, 201);
  const tooMany = await post('null');
  assert.equal(tooMany.status, 429);
  const denied = await post('https://attacker.invalid');
  assert.equal(denied.status, 403);
});