const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { hashPassword, verifyPassword } = require('../lib/hash');
const { normalizeNick } = require('../lib/slug');
const { authLimiter } = require('../middleware/rateLimit');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();
const RESERVED = new Set(['admin', 'commons', 'moderator', 'root', 'support', 'mod']);

function issueToken(nickname) {
  return jwt.sign({ nickname }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/signup', authLimiter, asyncHandler(async (req, res) => {
  const nickname = normalizeNick(req.body.nickname).toLowerCase();
  const password = req.body.password || '';
  const isAdult = !!req.body.isAdult;

  if (!/^[a-z0-9_-]{3,32}$/.test(nickname)) {
    return res.status(400).json({ error: 'Nickname must be 3-32 characters: letters, numbers, _ and - only.' });
  }
  if (RESERVED.has(nickname)) {
    return res.status(400).json({ error: 'That nickname is reserved.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = await query('SELECT nickname FROM accounts WHERE nickname = $1', [nickname]);
  if (existing.rows.length) {
    return res.status(409).json({ error: 'That nickname is already taken.' });
  }

  const passwordHash = await hashPassword(password);
  await query(
    'INSERT INTO accounts (nickname, password_hash, is_adult) VALUES ($1, $2, $3)',
    [nickname, passwordHash, isAdult]
  );

  res.status(201).json({ token: issueToken(nickname), nickname });
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const nickname = normalizeNick(req.body.nickname).toLowerCase();
  const password = req.body.password || '';

  const result = await query('SELECT * FROM accounts WHERE nickname = $1', [nickname]);
  const account = result.rows[0];
  if (!account) return res.status(404).json({ error: 'No account with that nickname.' });

  const valid = await verifyPassword(password, account.password_hash);
  if (!valid) return res.status(401).json({ error: 'Incorrect password.' });

  res.json({ token: issueToken(nickname), nickname, isAdult: account.is_adult });
}));

module.exports = router;
