// Message retention. Two rules, whichever a message hits first removes it:
//   - keep at most MAX_MESSAGES_PER_ROOM per room (newest kept)
//   - never keep anything older than MAX_MESSAGE_AGE_DAYS, regardless of count
//
// This runs lazily — triggered by a message being sent to a room, not by a
// scheduled job — because Render's free tier sleeps after 15 idle minutes,
// so a cron-style background job wouldn't fire reliably. Piggybacking on
// real traffic means it only ever runs while the app is already awake.
//
// Both numbers are configurable via env vars so you can tune them (or lower
// them for testing) without touching code.

const { query } = require('../db');

const MAX_MESSAGES_PER_ROOM = parseInt(process.env.MAX_MESSAGES_PER_ROOM, 10) || 500;
const MAX_MESSAGE_AGE_DAYS = parseInt(process.env.MAX_MESSAGE_AGE_DAYS, 10) || 90;

// Only run the (more expensive) count-based trim once a room has drifted this
// far past the cap, so we're not recomputing "top N" on every single message
// in a busy room — we trim in batches instead. Configurable mainly so tests
// can set it to 0 and verify the exact cap boundary without needing to send
// hundreds of messages first.
const TRIM_BATCH_BUFFER = process.env.TRIM_BATCH_BUFFER !== undefined
  ? parseInt(process.env.TRIM_BATCH_BUFFER, 10)
  : 50;

async function trimRoomMessages(roomId) {
  // Age-based delete is cheap (uses the existing room_id+created_at index)
  // and always safe to run.
  await query(
    `DELETE FROM messages WHERE room_id = $1 AND created_at < now() - ($2 || ' days')::interval`,
    [roomId, String(MAX_MESSAGE_AGE_DAYS)]
  );

  const countResult = await query('SELECT COUNT(*)::int AS count FROM messages WHERE room_id = $1', [roomId]);
  const count = countResult.rows[0].count;
  if (count <= MAX_MESSAGES_PER_ROOM + TRIM_BATCH_BUFFER) return;

  await query(
    `DELETE FROM messages
     WHERE room_id = $1
       AND id NOT IN (
         SELECT id FROM messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT $2
       )`,
    [roomId, MAX_MESSAGES_PER_ROOM]
  );
}

module.exports = { trimRoomMessages, MAX_MESSAGES_PER_ROOM, MAX_MESSAGE_AGE_DAYS };
