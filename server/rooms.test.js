const test = require('node:test');
const assert = require('node:assert/strict');
const { RoomRegistry, normalizeNickname } = require('./rooms');

test('creates a private room and joins its creator', () => {
  const rooms = new RoomRegistry({ createId: () => 'ABCDEFGHIJKLMNOP' });
  const created = rooms.create('socket-1', 'Maya');
  assert.equal(created.roomId, 'ABCDEFGHIJKLMNOP');
  assert.deepEqual(rooms.getParticipant('socket-1'), { roomId: 'ABCDEFGHIJKLMNOP', nickname: 'Maya' });
});

test('enforces the participant limit and rejects unknown rooms', () => {
  const rooms = new RoomRegistry({ maxParticipants: 2, createId: () => 'ABCDEFGHIJKLMNOP' });
  rooms.create('socket-1', 'Um');
  assert.equal(rooms.join('ABCDEFGHIJKLMNOP', 'socket-2', 'Dois').ok, true);
  assert.deepEqual(rooms.join('ABCDEFGHIJKLMNOP', 'socket-3', 'Três'), {
    ok: false,
    message: 'Esta sala já está cheia (limite de 2 pessoas).'
  });
  assert.equal(rooms.join('QRSTUVWXYZabcdef', 'socket-4', 'Quatro').ok, false);
});

test('prevents one socket from joining multiple rooms', () => {
  const ids = ['ABCDEFGHIJKLMNOP', 'QRSTUVWXYZabcdef'];
  const rooms = new RoomRegistry({ createId: () => ids.shift() });
  rooms.create('socket-1', 'Um');
  const otherRoom = rooms.create('socket-2', 'Dois');
  assert.equal(rooms.join(otherRoom.roomId, 'socket-1', 'Um').ok, false);
});

test('keeps empty rooms briefly and then expires them', () => {
  let now = 0;
  const rooms = new RoomRegistry({ roomTtlMs: 500, now: () => now, createId: () => 'ABCDEFGHIJKLMNOP' });
  rooms.create('socket-1', 'Um');
  rooms.leave('socket-1');
  now = 499;
  rooms.prune();
  assert.ok(rooms.getRoom('ABCDEFGHIJKLMNOP'));
  now = 500;
  rooms.prune();
  assert.equal(rooms.getRoom('ABCDEFGHIJKLMNOP'), null);
});

test('normalizes only bounded non-empty nicknames', () => {
  assert.equal(normalizeNickname('  Maya  '), 'Maya');
  assert.equal(normalizeNickname(' '), null);
  assert.equal(normalizeNickname('x'.repeat(21)), null);
  assert.equal(normalizeNickname(42), null);
});
