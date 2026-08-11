const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { escalationStatus } = require('../lib/escalation');
const { asyncHandler } = require('../lib/asyncHandler');

const router = express.Router();

// File a report. Nothing is inspected until this happens — no automated scanning.
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { roomId, roomName, nickname, text, reason, note } = req.body;
  if (!nickname || !text || !reason) {
    return res.status(400).json({ error: 'Missing fields.' });
  }

  await query(
    `INSERT INTO reports (room_id, room_name, reported_nickname, message_text, reason, note, reporter_nickname)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [roomId, roomName || null, nickname, text, reason, note || null, req.nickname]
  );
  res.status(201).json({ ok: true });
}));

// NOTE: in this MVP, any authenticated account can view/resolve the queue —
// same as the prototype. Add a real `role` column to `accounts` and gate
// these two routes on it before using this in production.
router.get('/queue', requireAuth, asyncHandler(async (req, res) => {
  const result = await query("SELECT * FROM reports WHERE status = 'pending' ORDER BY created_at DESC");
  res.json({ reports: result.rows });
}));

router.post('/:id/resolve', requireAuth, asyncHandler(async (req, res) => {
  const outcome = req.body.outcome; // 'dismissed' | 'actioned'
  if (!['dismissed', 'actioned'].includes(outcome)) {
    return res.status(400).json({ error: 'outcome must be dismissed or actioned.' });
  }

  const reportResult = await query('SELECT * FROM reports WHERE id = $1', [req.params.id]);
  const report = reportResult.rows[0];
  if (!report) return res.status(404).json({ error: 'Report not found.' });

  await query('UPDATE reports SET status = $1, resolved_at = now() WHERE id = $2', [outcome, req.params.id]);

  if (outcome === 'actioned') {
    await query('INSERT INTO violations (nickname) VALUES ($1)', [report.reported_nickname]);

    const violRows = await query('SELECT created_at FROM violations WHERE nickname = $1', [report.reported_nickname]);
    const timestamps = violRows.rows.map((r) => new Date(r.created_at).getTime());
    const status = escalationStatus(timestamps);
    return res.json({ ok: true, status });
  }

  res.json({ ok: true });
}));

module.exports = router;
