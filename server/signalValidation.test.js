const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidSignal } = require('./signalValidation');

test('accepts simple-peer negotiation and transceiver request signals', () => {
  assert.equal(isValidSignal({ type: 'offer', sdp: 'offer-sdp' }), true);
  assert.equal(isValidSignal({ type: 'answer', sdp: 'answer-sdp' }), true);
  assert.equal(isValidSignal({ type: 'candidate', candidate: { candidate: 'candidate:1' } }), true);
  assert.equal(isValidSignal({ type: 'renegotiate', renegotiate: true }), true);
  assert.equal(isValidSignal({ type: 'transceiverRequest', transceiverRequest: { kind: 'video' } }), true);
});

test('rejects malformed or unsupported negotiation signals', () => {
  assert.equal(isValidSignal({ type: 'transceiverRequest', transceiverRequest: { kind: 'application' } }), false);
  assert.equal(isValidSignal({ type: 'candidate', candidate: null }), false);
  assert.equal(isValidSignal({ type: 'offer' }), false);
  assert.equal(isValidSignal({ type: 'unknown' }), false);
  assert.equal(isValidSignal({ type: 'renegotiate', renegotiate: false }), false);
  assert.equal(isValidSignal(null), false);
});
