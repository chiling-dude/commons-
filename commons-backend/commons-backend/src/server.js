require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const messageRoutes = require('./routes/messages');
const reportRoutes = require('./routes/reports');
const accountRoutes = require('./routes/account');
const { attachSockets } = require('./sockets');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Copy .env.example to .env and fill it in before starting.');
  process.exit(1);
}

// Defense in depth — every route is wrapped in asyncHandler (see src/lib/asyncHandler.js),
// but this catches anything that still slips through rather than taking the process down.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

const app = express();
const server = http.createServer(app);

// Supports a comma-separated list (e.g. "http://localhost:5500,https://yourapp.com").
// If unset, allows any localhost/127.0.0.1 origin — fine for local testing,
// but set this explicitly to your real frontend domain before going live.
const rawOrigins = process.env.CORS_ORIGIN;
const allowedOrigins = rawOrigins ? rawOrigins.split(',').map((s) => s.trim()) : null;
function corsOriginCheck(origin, callback) {
  if (!origin) return callback(null, true); // curl, server-to-server, etc.
  if (!allowedOrigins) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ? callback(null, true)
      : callback(new Error('Not allowed by CORS'));
  }
  return allowedOrigins.includes(origin) ? callback(null, true) : callback(new Error('Not allowed by CORS'));
}

app.use(helmet());
app.use(cors({ origin: corsOriginCheck, credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/account', accountRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

const io = new Server(server, {
  cors: { origin: corsOriginCheck, credentials: true },
  // Add the Redis adapter here once you run more than one server instance —
  // see README's scaling section for why and how.
});
attachSockets(io);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Commons backend listening on :${PORT}`));
