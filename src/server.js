// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const callRoutes = require('./routes/calls');
const analyticsRoutes = require('./routes/analytics');
const initRoutes = require('./routes/init');
const { verifyToken, verifyTokenSocket } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Re‑use a single Prisma client instance for the whole server
const prisma = new PrismaClient();

// Security middlewares
app.use(helmet());

// Tighten CORS to allowed origins (use FRONTEND_ORIGIN env or localhost defaults)
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:4002,http://localhost:4000').split(',');
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    return callback(new Error('CORS policy: origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Body parser with limit
app.use(express.json({ limit: '50kb' }));

// Rate limiter
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX, 10) : 100 });
app.use('/api/', apiLimiter);

// Serve static frontend files from the `public` folder
app.use(express.static(path.join(__dirname, '..', 'public')));

// Public routes
app.use('/api/auth', authRoutes);
app.use('/api/init', initRoutes);

// Serve home at root
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'home.html')));

// Serve dashboard directly
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'Dashboard.html')));

// Serve dashboard explicitly
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'Dashboard.html')));

// Protected routes
app.use('/api/users', verifyToken, userRoutes);
app.use('/api/messages', verifyToken, messageRoutes);
app.use('/api/calls', verifyToken, callRoutes);
app.use('/api/analytics', verifyToken, analyticsRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Socket.io real‑time handling
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication error: missing token'));
  try {
    const payload = await verifyTokenSocket(token, true);
    socket.user = payload;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log(`User ${socket.user.id} connected via socket`);

  // Join personal room for direct messages
  socket.join(`user_${socket.user.id}`);

  // Message sending
  socket.on('sendMessage', async ({ toUserId, content }) => {
    const receiverId = parseInt(toUserId, 10);
    if (!content || typeof content !== 'string' || !content.trim()) {
      return socket.emit('error', { error: 'Message content is required' });
    }
    if (Number.isNaN(receiverId)) {
      return socket.emit('error', { error: 'Invalid receiver id' });
    }
    try {
      const message = await prisma.message.create({
        data: {
          senderId: socket.user.id,
          receiverId,
          content: content.trim(),
        },
      });
      // Emit to receiver if online
      io.to(`user_${receiverId}`).emit('newMessage', message);
      // Also emit back to sender for confirmation
      socket.emit('messageSent', message);
    } catch (err) {
      console.error(err);
      socket.emit('error', { error: 'Failed to send message' });
    }
  });

  // Call handling (simple signalling)
  socket.on('startCall', async ({ participants, title, type }) => {
    const safeTitle = typeof title === 'string' ? title.trim() : '';
    const safeParticipants = Array.isArray(participants) ? participants : [];
    const allParticipants = Array.from(
      new Set(
        safeParticipants
          .map((id) => parseInt(id, 10))
          .filter((id) => !Number.isNaN(id))
          .concat(socket.user.id),
      ),
    );

    if (!safeTitle) {
      return socket.emit('error', { error: 'Call title is required' });
    }

    try {
      const call = await prisma.call.create({
        data: {
          title: safeTitle,
          participants: allParticipants,
          type: type === 'VIDEO' ? 'VIDEO' : 'AUDIO',
          status: 'ONGOING',
        },
      });
      allParticipants.forEach((uid) => {
        io.to(`user_${uid}`).emit('callStarted', call);
      });
    } catch (err) {
      console.error(err);
      socket.emit('error', { error: 'Failed to start call' });
    }
  });

  socket.on('endCall', async ({ callId }) => {
    const id = parseInt(callId, 10);
    if (Number.isNaN(id)) {
      return socket.emit('error', { error: 'Invalid call id' });
    }
    try {
      const call = await prisma.call.update({
        where: { id },
        data: { status: 'COMPLETED' },
      });
      call.participants.forEach((uid) => {
        io.to(`user_${uid}`).emit('callEnded', call);
      });
    } catch (err) {
      console.error(err);
      socket.emit('error', { error: 'Failed to end call' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`User ${socket.user.id} disconnected`);
  });
});

const PORT = process.env.PORT || 4002;
if (!process.env.JWT_SECRET) {
  console.error('[security] JWT_SECRET is not set. Set JWT_SECRET in your .env and restart the server.');
  process.exit(1);
}

server.listen(PORT, () => console.log(`🚀 Backend listening on port ${PORT}`));
