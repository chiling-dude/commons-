const rateLimit = require('express-rate-limit');

// Signup/login: generous enough for real use, tight enough to slow brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Room creation / reports — infrequent actions, no need for a generous window.
const actionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Slow down — try again in a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, actionLimiter };
