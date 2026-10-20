const { randomBytes } = require('node:crypto');

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{16}$/;

function normalizeNickname(value) {
  if (typeof value !== 'string') return null;
  const nickname = value.trim();
  return nickname.length > 0 && nickname.length <= 20 ? nickname : null;
}

class RoomRegistry {
  constructor({ maxParticipants = 10, roomTtlMs = 5 * 60_000, now = Date.now, createId } = {}) {
    this.maxParticipants = maxParticipants;
    this.roomTtlMs = roomTtlMs;
    this.now = now;
    this.createId = createId || (() => randomBytes(12).toString('base64url'));
    this.rooms = new Map();
    this.participantRooms = new Map();
  }

  create(socketId, nickname) {
    let roomId;
    do {
      roomId = this.createId();
    } while (this.rooms.has(roomId));
    const room = { roomId, participants: new Map(), expiresAt: null, youtubeState: null };
    this.rooms.set(roomId, room);
    this.addParticipant(room, socketId, nickname);
    return { roomId, alreadyJoined: false };
  }

  join(roomId, socketId, nickname) {
    if (typeof roomId !== 'string' || !ROOM_ID_PATTERN.test(roomId)) {
      return { ok: false, message: 'O link da sala é inválido.' };
    }
    this.prune();
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, message: 'Sala não encontrada ou encerrada.' };
    if (this.participantRooms.has(socketId)) {
      if (this.participantRooms.get(socketId) === roomId) return { ok: true, roomId, alreadyJoined: true };
      return { ok: false, message: 'Saia da sala atual antes de entrar em outra.' };
    }
    if (room.participants.size >= this.maxParticipants) {
      return { ok: false, message: `Esta sala já está cheia (limite de ${this.maxParticipants} pessoas).` };
    }
    this.addParticipant(room, socketId, nickname);
    return { ok: true, roomId, alreadyJoined: false };
  }

  addParticipant(room, socketId, nickname) {
    room.participants.set(socketId, nickname);
    room.expiresAt = null;
    this.participantRooms.set(socketId, room.roomId);
  }

  leave(socketId) {
    const roomId = this.participantRooms.get(socketId);
    if (!roomId) return null;
    const room = this.rooms.get(roomId);
    const nickname = room?.participants.get(socketId);
    this.participantRooms.delete(socketId);
    room?.participants.delete(socketId);
    if (room && room.participants.size === 0) room.expiresAt = this.now() + this.roomTtlMs;
    return { roomId, nickname };
  }

  getParticipant(socketId) {
    const roomId = this.participantRooms.get(socketId);
    const room = roomId ? this.rooms.get(roomId) : null;
    const nickname = room?.participants.get(socketId);
    return nickname ? { roomId, nickname } : null;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  prune() {
    const now = this.now();
    for (const [roomId, room] of this.rooms) {
      if (room.expiresAt !== null && room.expiresAt <= now && room.participants.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }
}

module.exports = { RoomRegistry, normalizeNickname };
