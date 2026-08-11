const express = require('express');
const { query } = require('../db');
const { slugify } = require('../lib/slug');
const { requireAuth } = require('../middleware/auth');
const { actionLimiter } = require('../middleware/rateLimit');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const result = await query('SELECT id, name, type, created_at FROM rooms ORDER BY created_at ASC');
  res.json({ rooms: result.rows });
}));

router.post('/', requireAuth, actionLimiter, asyncHandler(async (req, res) => {
  const name = (req.body.name || '').trim();
  const slug = slugify(name);

  if (slug.length < 3) {
    return res.status(400).json({ error: 'Room name too short once simplified — try at least 3 letters/numbers.' });
  }

  const existing = await query('SELECT id FROM rooms WHERE id = $1', [slug]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'A room with that name already exists.' });
  }

  await query(
    'INSERT INTO rooms (id, name, type, created_by) VALUES ($1, $2, $3, $4)',
    [slug, slug, 'user', req.nickname]
  );
  res.status(201).json({ id: slug, name: slug });
}));

module.exports = router;
