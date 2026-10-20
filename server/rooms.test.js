const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomRegistry, normalizeNickname } = require('./rooms');

test('generates four-letter uppercase room codes', () => {
  const rooms = new RoomRegistry();
  const { roomId } = rooms.create('socket-1', 'Maya');
  assert.match(roomId, /^[A-Z]{4}$/);
});

test('creates a private room and joins its creator', () => {
  const rooms = new RoomRegistry({ createId: () => 'ABCD' });
  const created = rooms.create('socket-1', 'Maya');
  assert.equal(created.roomId, 'ABCD');
  assert.deepEqual(rooms.getParticipant('socket-1'), { roomId: 'ABCD', nickname: 'Maya' });
});

test('enforces the participant limit and rejects unknown rooms', () => {
  const rooms = new RoomRegistry({ maxParticipants: 2, createId: () => 'ABCD' });
  rooms.create('socket-1', 'Um');
  assert.equal(rooms.join('abcd', 'socket-2', 'Dois').ok, true);
  assert.deepEqual(rooms.join('ABCD', 'socket-3', 'Três'), {
    ok: false,
    message: 'Esta sala já está cheia (limite de 2 pessoas).'
  });
  assert.equal(rooms.join('EFGH', 'socket-4', 'Quatro').ok, false);
  assert.equal(rooms.join('ABC123', 'socket-5', 'Cinco').ok, false);
});

test('prevents one socket from joining multiple rooms', () => {
  const ids = ['ABCD', 'EFGH'];
  const rooms = new RoomRegistry({ createId: () => ids.shift() });
  rooms.create('socket-1', 'Um');
  const otherRoom = rooms.create('socket-2', 'Dois');
  assert.equal(rooms.join(otherRoom.roomId, 'socket-1', 'Um').ok, false);
});

test('keeps empty rooms briefly and then expires them', () => {
  let now = 0;
  const rooms = new RoomRegistry({ roomTtlMs: 500, now: () => now, createId: () => 'ABCD' });
  rooms.create('socket-1', 'Um');
  rooms.leave('socket-1');
  now = 499;
  rooms.prune();
  assert.ok(rooms.getRoom('ABCD'));
  now = 500;
  rooms.prune();
  assert.equal(rooms.getRoom('ABCD'), null);
});

test('normalizes only bounded non-empty nicknames', () => {
  assert.equal(normalizeNickname('  Maya  '), 'Maya');
  assert.equal(normalizeNickname(' '), null);
  assert.equal(normalizeNickname('x'.repeat(21)), null);
  assert.equal(normalizeNickname(42), null);
});
