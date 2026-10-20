const crypto = require('node:crypto');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const { Server } = require('socket.io');
const { RoomRegistry, normalizeNickname } = require('./rooms');
const { getAllowedOrigins } = require('./cors');
const { isValidSignal } = require('./signalValidation');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const server = http.createServer(app);
const allowedOrigins = getAllowedOrigins(process.env.ALLOWED_ORIGINS);
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  maxHttpBufferSize: 100_000,
  pingInterval: 25_000,
  pingTimeout: 20_000
});
const rooms = new RoomRegistry();

app.use((request, response, next) => {
  const origin = request.get('origin');
  if (origin && !allowedOrigins.includes(origin)) return response.status(403).json({ error: 'origin_not_allowed' });
  if (origin) {
    response.set('Access-Control-Allow-Origin', origin);
    response.set('Vary', 'Origin');
    response.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (request.method === 'OPTIONS') return response.sendStatus(204);
  next();
});

app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.get('/api/ice-servers', (_request, response) => {
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turnUrls = (process.env.TURN_URLS || '').split(',').map((url) => url.trim()).filter(Boolean);
  const turnSecret = process.env.TURN_SHARED_SECRET;
  if (turnUrls.length && !turnSecret) return response.status(503).json({ error: 'turn_shared_secret_required' });
  if (turnUrls.length) {
    const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const username = `${expiresAt}:linko`;
    const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
  }
  response.json({ iceServers, turnConfigured: turnUrls.length > 0 });
});

const roomExpiry = setInterval(() => rooms.prune(), 60_000);
roomExpiry.unref();

io.on('connection', (socket) => {
  socket.on('create-room', (payload = {}, acknowledge) => {
    if (!isRecord(payload)) return reply(acknowledge, { ok: false, message: 'Pedido inválido.' });
    const nickname = normalizeNickname(payload.nickname);
    if (!nickname) return reply(acknowledge, { ok: false, message: 'Informe um apelido de até 20 caracteres.' });
    if (rooms.getParticipant(socket.id)) {
      return reply(acknowledge, { ok: false, message: 'Saia da sala atual antes de criar outra.' });
    }
    const result = rooms.create(socket.id, nickname);
    socket.join(result.roomId);
    reply(acknowledge, roomResponse(result, socket.id));
  });

  socket.on('join-room', (payload = {}, acknowledge) => {
    if (!isRecord(payload)) return reply(acknowledge, { ok: false, message: 'Pedido inválido.' });
    const nickname = normalizeNickname(payload.nickname);
    if (!nickname) return reply(acknowledge, { ok: false, message: 'Informe um apelido de até 20 caracteres.' });
    const result = rooms.join(payload.roomId, socket.id, nickname);
    if (!result.ok) return reply(acknowledge, { ok: false, message: result.message });
    socket.join(result.roomId);
    if (!result.alreadyJoined) {
      socket.to(result.roomId).emit('user-connected', { socketId: socket.id, nickname });
    }
    reply(acknowledge, roomResponse(result, socket.id));
  });

  socket.on('leave-room', () => leaveRoom(socket));
  socket.on('signal', (payload = {}, acknowledge) => {
    if (!isRecord(payload)) return reply(acknowledge, { ok: false, message: 'Sinalização inválida.' });
    const source = rooms.getParticipant(socket.id);
    const target = rooms.getParticipant(payload.targetSocketId);
    const signal = payload.signal;
    if (!source || !target || source.roomId !== target.roomId || !isValidSignal(signal)) {
      return reply(acknowledge, { ok: false, message: 'Sinalização inválida.' });
    }
    io.to(payload.targetSocketId).emit('signal', { from: socket.id, signal });
    reply(acknowledge, { ok: true });
  });

  socket.on('youtube-control', (payload = {}, acknowledge) => {
    if (!isRecord(payload)) return reply(acknowledge, { ok: false, message: 'Comando de vídeo inválido.' });
    const participant = rooms.getParticipant(socket.id);
    const state = validateYoutubeControl(payload);
    if (!participant || !state) return reply(acknowledge, { ok: false, message: 'Comando de vídeo inválido.' });
    const room = rooms.getRoom(participant.roomId);
    room.youtubeState = { ...state, updatedAt: Date.now() };
    socket.to(participant.roomId).emit('youtube-control', room.youtubeState);
    reply(acknowledge, { ok: true });
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

function roomResponse(result, socketId) {
  const room = rooms.getRoom(result.roomId);
  return {
    ok: true,
    roomId: result.roomId,
    participants: Array.from(room.participants, ([id, nickname]) => ({ socketId: id, nickname }))
      .filter((participant) => participant.socketId !== socketId),
    youtubeState: room.youtubeState
  };
}

function leaveRoom(socket) {
  const result = rooms.leave(socket.id);
  if (!result) return;
  socket.to(result.roomId).emit('user-disconnected', { socketId: socket.id, nickname: result.nickname });
  socket.leave(result.roomId);
}

function validateYoutubeControl(payload) {
  if (!isRecord(payload)) return null;
  const allowedActions = new Set(['load', 'play', 'pause', 'seek', 'stop']);
  if (!allowedActions.has(payload.action)) return null;
  if (payload.action !== 'stop' && !/^[A-Za-z0-9_-]{11}$/.test(payload.videoId || '')) return null;
  const currentTime = Number(payload.currentTime);
  if (!Number.isFinite(currentTime) || currentTime < 0 || currentTime > 86_400) return null;
  return {
    action: payload.action,
    videoId: payload.action === 'stop' ? null : payload.videoId,
    currentTime
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reply(acknowledge, response) {
  if (typeof acknowledge === 'function') acknowledge(response);
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Linko signaling server listening on port ${port}`));
}

module.exports = { app, io, rooms, server };
