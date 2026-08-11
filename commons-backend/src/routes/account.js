const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { hashPassword, verifyPassword } = require('../lib/hash');
const { escalationStatus, PERMANENT_BAN_DELETE_DELAY_MS } = require('../lib/escalation');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();

async function getViolationTimestamps(nickname) {
  const result = await query('SELECT created_at FROM violations WHERE nickname = $1', [nickname]);
  return result.rows.map((r) => new Date(r.created_at).getTime());
}

async function deleteAccount(nickname) {
  await query('DELETE FROM accounts WHERE nickname = $1', [nickname]);
  await query('DELETE FROM violations WHERE nickname = $1', [nickname]);
  await query('DELETE FROM blocks WHERE nickname = $1 OR blocked_nickname = $1', [nickname]);
}

// The client calls this right after login and whenever it re-enters the app.
// A permanent restriction becomes an actual deletion here, 24h after it began —
// this is the one place that check can happen safely, since there's no
// persistent background job in this MVP (see README's scaling notes).
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const timestamps = await getViolationTimestamps(req.nickname);
  const status = escalationStatus(timestamps);

  if (status.permanent) {
    const deleteAt = status.permanentAt + PERMANENT_BAN_DELETE_DELAY_MS;
    if (Date.now() >= deleteAt) {
      await deleteAccount(req.nickname);
      return res.json({ deleted: true });
    }
    return res.json({ status, deleteAt });
  }

  res.json({ status });
}));

router.get('/violations', requireAuth, asyncHandler(async (req, res) => {
  const timestamps = await getViolationTimestamps(req.nickname);
  res.json({ violations: timestamps.sort((a, b) => b - a) });
}));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  }

  const result = await query('SELECT password_hash FROM accounts WHERE nickname = $1', [req.nickname]);
  const account = result.rows[0];
  if (!account) return res.status(404).json({ error: 'Account not found.' });

  const valid = await verifyPassword(currentPassword || '', account.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

  const newHash = await hashPassword(newPassword);
  await query('UPDATE accounts SET password_hash = $1 WHERE nickname = $2', [newHash, req.nickname]);
  res.json({ ok: true });
}));

router.get('/blocked', requireAuth, asyncHandler(async (req, res) => {
  const result = await query(
    'SELECT blocked_nickname FROM blocks WHERE nickname = $1 ORDER BY created_at DESC',
    [req.nickname]
  );
  res.json({ blocked: result.rows.map((r) => r.blocked_nickname) });
}));

router.post('/block', requireAuth, asyncHandler(async (req, res) => {
  const target = (req.body.nickname || '').toLowerCase();
  if (!target) return res.status(400).json({ error: 'Missing nickname.' });
  if (target === req.nickname) return res.status(400).json({ error: "You can't block yourself." });

  await query(
    'INSERT INTO blocks (nickname, blocked_nickname) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.nickname, target]
  );
  res.json({ ok: true });
}));

router.post('/unblock', requireAuth, asyncHandler(async (req, res) => {
  const target = (req.body.nickname || '').toLowerCase();
  await query('DELETE FROM blocks WHERE nickname = $1 AND blocked_nickname = $2', [req.nickname, target]);
  res.json({ ok: true });
}));

module.exports = router;
