const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const previousUrl = process.env.METERED_TURN_CREDENTIALS_URL;
const previousKey = process.env.METERED_TURN_API_KEY;
const previousFetch = global.fetch;
process.env.METERED_TURN_CREDENTIALS_URL = 'https://linko.metered.live/api/v1/turn/credentials';
process.env.METERED_TURN_API_KEY = 'test-api-key';

const { app } = require('./index');
const server = app.listen(0);

function requestIceServers() {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/ice-servers' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

test('returns Metered TURN credentials without exposing the provider API key', async () => {
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = new URL(url);
    return {
      ok: true,
      json: async () => [
        { urls: 'stun:stun.relay.metered.ca:80' },
        { urls: ['turn:relay.metered.ca:80?transport=tcp', 'turns:relay.metered.ca:443'], username: 'temporary-user', credential: 'temporary-password' }
      ]
    };
  };

  const response = await requestIceServers();
  assert.equal(response.status, 200);
  assert.equal(response.body.turnConfigured, true);
  assert.deepEqual(response.body.iceServers[0], { urls: 'stun:stun.relay.metered.ca:80' });
  assert.equal(response.body.iceServers[1].username, 'temporary-user');
  assert.deepEqual(response.body.iceServers[1].urls, ['turn:relay.metered.ca:80?transport=tcp', 'turns:relay.metered.ca:443']);
  assert.equal(requestedUrl.searchParams.get('apiKey'), 'test-api-key');
  assert.equal(JSON.stringify(response.body).includes('test-api-key'), false);
});

test('returns an explicit error when Metered credentials are unavailable', async () => {
  global.fetch = async () => ({ ok: false, status: 503 });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await requestIceServers();
    assert.equal(response.status, 502);
    assert.deepEqual(response.body, { error: 'turn_provider_unavailable' });
  } finally {
    console.error = originalConsoleError;
  }
});

test('does not report TURN configured when Metered returns only STUN', async () => {
  global.fetch = async () => ({
    ok: true,
    json: async () => [{ urls: 'stun:stun.relay.metered.ca:80' }]
  });
  const response = await requestIceServers();
  assert.equal(response.status, 502);
  assert.deepEqual(response.body, { error: 'metered_turn_invalid_response' });
});

test('rejects Metered endpoints outside the documented credentials API', async () => {
  process.env.METERED_TURN_CREDENTIALS_URL = 'https://example.com/api/v1/turn/credentials';
  const response = await requestIceServers();
  assert.equal(response.status, 503);
  assert.deepEqual(response.body, { error: 'metered_turn_endpoint_invalid' });
  process.env.METERED_TURN_CREDENTIALS_URL = 'https://linko.metered.live/api/v1/turn/credentials';
});

test.after(() => {
  server.close();
  global.fetch = previousFetch;
  if (previousUrl === undefined) delete process.env.METERED_TURN_CREDENTIALS_URL;
  else process.env.METERED_TURN_CREDENTIALS_URL = previousUrl;
  if (previousKey === undefined) delete process.env.METERED_TURN_API_KEY;
  else process.env.METERED_TURN_API_KEY = previousKey;
});
