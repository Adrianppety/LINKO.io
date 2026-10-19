const express = require('express');
const http = require('http');
const path = require('node:path');
const socketIo = require('socket.io');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { SettingsStore, createReportsRouter } = require('./settingsStore');
const { AuthService, createAuthRouter } = require('./auth');
const { createEmailService } = require('./emailService');

const app = express();

// Only create HTTP server and Socket.io if not in Vercel (serverless environment)
const isVercel = process.env.VERCEL === '1' || process.env.VERCEL_ENV !== undefined;
let server;
let io;

if (!isVercel) {
  server = http.createServer(app);
  io = socketIo(server, {
    cors: {
      origin: [], // Will be set after authService is initialized
      credentials: true,
      methods: ['GET', 'POST']
    }
  });
}

const databasePath = process.env.LINKO_DATABASE_PATH ? path.resolve(__dirname, process.env.LINKO_DATABASE_PATH) : path.join(__dirname, 'data', 'linko.sqlite');
const filesDirectory = process.env.LINKO_FILES_PATH ? path.resolve(__dirname, process.env.LINKO_FILES_PATH) : path.join(__dirname, 'data', 'files');
const settingsStore = new SettingsStore(databasePath);
const authService = new AuthService({ store: settingsStore, mailer: createEmailService(), filesDirectory });

// Update Socket.io CORS origins after authService is initialized
if (!isVercel && io) {
  io.engine.generateId = (req) => {
    return authService.getSocketUser(req.headers.cookie) ? authService.getSocketUser(req.headers.cookie).id : req.id || '';
  };

  // Set CORS origins from authService
  io.of("/").adapter.on("create-room", (room) => {
    // Room creation logic if needed
  });

  // Update CORS dynamically
  io._cors = {
    origin: [...authService.allowedOrigins],
    credentials: true,
    methods: ['GET', 'POST']
  };
}

// Middleware - only apply static serving in non-Vercel environments to avoid conflict with Vercel static build
if (!isVercel) {
  app.use(express.static(path.join(__dirname, '../client/public')));
  app.use(express.static(path.join(__dirname, '../client')));
}

app.use(express.json({ limit: '2mb' }));
app.use('/api', createAuthRouter(authService, { io }));
app.use('/api/reports', createReportsRouter(settingsStore, {}, authService));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.io connection handling (only in non-Vercel environments)
if (!isVercel && io) {
  // Store active rooms and users
  const rooms = new Map();

  io.use((socket, next) => {
    const user = authService.getSocketUser(socket.handshake.headers.cookie);
    if (!user) return next(new Error('session_required'));
    socket.data.user = { id: user.id, nickname: user.nickname, displayName: user.display_name };
    return next();
  });

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.join(`user:${socket.data.user.id}`);
    socket.on('leave-room', (conversationId) => {
      if (typeof conversationId !== 'string' || !socket.rooms.has(conversationId)) return;
      socket.leave(conversationId);
      const roomUsers = rooms.get(conversationId);
      roomUsers?.delete(socket.id);
      socket.to(conversationId).emit('user-disconnected', socket.id);
      if (roomUsers?.size === 0) rooms.delete(conversationId);
    });

    socket.on('join-room', (conversationId) => {
      if (typeof conversationId !== 'string' || !authService.isConversationMember(conversationId, socket.data.user.id)) {
        socket.emit('room-error', { code: 'conversation_forbidden' });
        return;
      }
      socket.join(conversationId);

      if (!rooms.has(conversationId)) {
        rooms.set(conversationId, new Set());
      }

      const roomUsers = rooms.get(conversationId);
      roomUsers.add(socket.id);

      socket.to(conversationId).emit('user-connected', socket.data.user.nickname, socket.id);

      const existingUsers = Array.from(roomUsers).filter(id => id !== socket.id).map(id => {
        const peer = io.sockets.sockets.get(id);
        return peer ? { id: peer.data.user.id, nickname: peer.data.user.nickname, socketId: id } : null;
      }).filter(Boolean);
      socket.emit('room-users', existingUsers);

      console.log(`User ${socket.data.user.nickname} joined conversation ${conversationId}`);
    });

    socket.on('offer', (conversationId, offer) => {
      if (!socket.rooms.has(conversationId)) return;
      socket.to(conversationId).emit('offer', offer, socket.id, socket.id);
    });

    socket.on('answer', (conversationId, answer, _clientSender, targetSocketId) => {
      if (!socket.rooms.has(conversationId) || !rooms.get(conversationId)?.has(targetSocketId)) return;
      io.to(targetSocketId).emit('answer', answer, socket.id, socket.id);
    });

    socket.on('ice-candidate', (conversationId, candidate, _clientSender, targetSocketId) => {
      if (!socket.rooms.has(conversationId) || !rooms.get(conversationId)?.has(targetSocketId)) return;
      io.to(targetSocketId).emit('ice-candidate', candidate, socket.id, socket.id);
    });

    socket.on('input-event', (conversationId, eventData) => {
      if (!socket.rooms.has(conversationId) || !eventData || typeof eventData !== 'object') return;
      socket.to(conversationId).emit('input-event', eventData, socket.data.user.nickname);
    });

    // Handle user leaving
    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);

      // Remove user from all rooms
      rooms.forEach((userSet, roomId) => {
        if (userSet.has(socket.id)) {
          userSet.delete(socket.id);
          // Notify others in the room
          socket.to(roomId).emit('user-disconnected', socket.id);

          // Clean up empty rooms
          if (userSet.size === 0) {
            rooms.delete(roomId);
          }
        }
      });
    });

    socket.on('chat-message', (conversationId, message) => {
      if (!socket.rooms.has(conversationId) || typeof message !== 'string') return;
      const content = message.trim();
      if (!content || content.length > 5000) return;
      const id = require('node:crypto').randomUUID();
      const createdAt = new Date().toISOString();
      try {
        authService.db.prepare('INSERT INTO messages (id,conversation_id,sender_user_id,content,created_at) VALUES (?,?,?,?,?)')
          .run(id,conversationId,socket.data.user.id,content,createdAt);
        io.to(conversationId).emit('chat-message', content, socket.data.user.nickname, { id, createdAt });
      } catch (error) {
        console.error('Message persistence failed:', error.message);
        socket.emit('message-error', { code: 'message_unavailable' });
      }
    });
  });
}

// Start server only in non-Vercel environments
if (!isVercel && server) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
  });
}

// Export app for Vercel serverless functions
module.exports = app;

// For backward compatibility, also export io and authService if needed
module.exports.io = io;
module.exports.authService = authService;
module.exports.settingsStore = settingsStore;