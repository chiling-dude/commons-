const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();

// ?before=<ISO timestamp> loads the 50 (or ?limit=) messages immediately
// before that point — this is how "load earlier messages" reaches anything
// beyond the most recent page, up to the retention boundary.
router.get('/:roomId', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const before = req.query.before;

  const result = before
    ? await query(
        'SELECT nickname, text, created_at FROM messages WHERE room_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3',
        [req.params.roomId, before, limit]
      )
    : await query(
        'SELECT nickname, text, created_at FROM messages WHERE room_id = $1 ORDER BY created_at DESC LIMIT $2',
        [req.params.roomId, limit]
      );

  res.json({ messages: result.rows.reverse(), hasMore: result.rows.length === limit });
}));

module.exports = router;
