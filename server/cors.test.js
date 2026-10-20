const test = require('node:test');
const assert = require('node:assert/strict');
const { getAllowedOrigins } = require('./cors');

test('allows the deployed Linko Vercel origins even when custom origins are configured', () => {
  const origins = getAllowedOrigins('https://app.example.com');
  assert.ok(origins.includes('https://linkoio-git-main-adrian-pety.vercel.app'));
  assert.ok(origins.includes('https://linkoio-bice.vercel.app'));
  assert.ok(origins.includes('https://app.example.com'));
});

test('deduplicates configured origins and keeps local development', () => {
  const origins = getAllowedOrigins('http://localhost:5173, https://app.example.com,https://app.example.com');
  assert.equal(origins.filter((origin) => origin === 'https://app.example.com').length, 1);
  assert.ok(origins.includes('http://localhost:5173'));
});

test('does not allow arbitrary origins', () => {
  const origins = getAllowedOrigins('https://app.example.com');
  assert.equal(origins.includes('https://not-linko.vercel.app'), false);
});
