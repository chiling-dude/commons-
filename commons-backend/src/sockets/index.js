const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { escalationStatus } = require('../lib/escalation');
const { trimRoomMessages } = require('../lib/retention');

function socketAuth(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Not authenticated'));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.nickname = payload.nickname;
    next();
  } catch (err) {
    next(new Error('Invalid session'));
  }
}

async function isSuspended(nickname) {
  const result = await query('SELECT created_at FROM violations WHERE nickname = $1', [nickname]);
  const timestamps = result.rows.map((r) => new Date(r.created_at).getTime());
  return escalationStatus(timestamps).suspended;
}

// In-memory flood guard. Fine for a single instance; once you run more than
// one server process, replace this with a Redis-backed check (see README).
const lastMessageAt = new Map();

function attachSockets(io) {
  io.use(socketAuth);

  io.on('connection', (socket) => {
    socket.on('join_room', (roomId) => {
      if (typeof roomId === 'string' && roomId.length) socket.join(roomId);
    });

    socket.on('leave_room', (roomId) => {
      if (typeof roomId === 'string' && roomId.length) socket.leave(roomId);
    });

    socket.on('send_message', async (payload, ack) => {
      try {
        const roomId = payload?.roomId;
        const text = (payload?.text || '').trim().slice(0, 2000);
        if (!roomId || !text) return ack?.({ error: 'Missing room or text.' });

        const now = Date.now();
        const last = lastMessageAt.get(socket.nickname) || 0;
        if (now - last < 600) {
          return ack?.({ error: 'Sending too fast.' });
        }
        lastMessageAt.set(socket.nickname, now);

        // Real enforcement — a suspended account is rejected server-side,
        // not just hidden in the UI.
        if (await isSuspended(socket.nickname)) {
          return ack?.({ error: 'Your account is currently restricted.' });
        }

        const result = await query(
          'INSERT INTO messages (room_id, nickname, text) VALUES ($1,$2,$3) RETURNING nickname, text, created_at',
          [roomId, socket.nickname, text]
        );
        const message = result.rows[0];
        io.to(roomId).emit('new_message', { roomId, message });
        ack?.({ ok: true });

        // Fire-and-forget: keeps the room's history within the retention
        // policy without adding latency to this send.
        trimRoomMessages(roomId).catch((err) => console.error('trimRoomMessages error', err));
      } catch (err) {
        console.error('send_message error', err);
        ack?.({ error: 'Could not send message.' });
      }
    });

    socket.on('disconnect', () => {
      lastMessageAt.delete(socket.nickname);
    });
  });
}

module.exports = { attachSockets };
