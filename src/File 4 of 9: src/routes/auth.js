// routes/auth.js — login, first-time owner setup, and user management.
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { hashPin, verifyPin, signToken, requireAuth, requireRole } = require('../auth');

function publicUser(u) {
  return { id: u.id, username: u.username, display_name: u.display_name, role: u.role, active: !!u.active, last_login: u.last_login };
}

// --- First-time setup: create the owner account. Only works if no users exist yet. ---
router.post('/setup', async (req, res) => {
  try {
    const existing = await pool.query('SELECT COUNT(*) as c FROM users');
    if (Number(existing.rows[0].c) > 0) {
      return res.status(400).json({ error: 'Setup already completed. Please log in instead.' });
    }
    const { username, pin, display_name } = req.body;
    if (!username || !pin || !display_name) {
      return res.status(400).json({ error: 'Username, PIN, and display name are all required' });
    }
    if (String(pin).length < 4) {
      return res.status(400).json({ error: 'PIN must be at least 4 digits' });
    }
    const result = await pool.query(
      `INSERT INTO users (username, pin_hash, display_name, role) VALUES ($1, $2, $3, 'owner') RETURNING *`,
      [username.toLowerCase().trim(), hashPin(pin), display_name.trim()]
    );
    const user = result.rows[0];
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not complete setup' });
  }
});

router.get('/setup-status', async (req, res) => {
  try {
    const existing = await pool.query('SELECT COUNT(*) as c FROM users');
    res.json({ needs_setup: Number(existing.rows[0].c) === 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not check setup status' });
  }
});

// --- Login ---
router.post('/login', async (req, res) => {
  try {
    const { username, pin } = req.body;
    if (!username || !pin) return res.status(400).json({ error: 'Username and PIN are required' });
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [String(username).toLowerCase().trim()]);
    const user = result.rows[0];
    if (!user || !verifyPin(pin, user.pin_hash)) {
      return res.status(401).json({ error: 'Incorrect username or PIN' });
    }
    if (!user.active) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact the owner.' });
    }
    await pool.query('UPDATE users SET last_login = now() WHERE id = $1', [user.id]);
    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not log in' });
  }
});

// --- Who am I (used to validate a stored token on app load) ---
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Session no longer valid' });
    res.json({ user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load account' });
  }
});

// --- User management (owner only) ---
router.get('/users', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY created_at ASC');
    res.json({ users: result.rows.map(publicUser) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load users' });
  }
});

router.post('/users', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const { username, pin, display_name, role } = req.body;
    if (!username || !pin || !display_name || !role) {
      return res.status(400).json({ error: 'Username, PIN, display name, and role are all required' });
    }
    if (!['owner', 'manager', 'employee'].includes(role)) {
      return res.status(400).json({ error: 'Role must be owner, manager, or employee' });
    }
    if (String(pin).length < 4) {
      return res.status(400).json({ error: 'PIN must be at least 4 digits' });
    }
    const result = await pool.query(
      `INSERT INTO users (username, pin_hash, display_name, role) VALUES ($1, $2, $3, $4) RETURNING *`,
      [username.toLowerCase().trim(), hashPin(pin), display_name.trim(), role]
    );
    res.json({ user: publicUser(result.rows[0]) });
  } catch (e) {
    if (e.code === '23505') { // Postgres unique_violation
      return res.status(400).json({ error: 'That username is already taken' });
    }
    console.error(e);
    res.status(500).json({ error: 'Could not create user' });
  }
});

router.patch('/users/:id', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const targetResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    const target = targetResult.rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });

    const { display_name, role, active, pin } = req.body;
    if (target.role === 'owner' && role && role !== 'owner' && req.user.id === target.id) {
      return res.status(400).json({ error: "You can't remove your own owner role" });
    }
    const result = await pool.query(
      `UPDATE users SET
         display_name = COALESCE($1, display_name),
         role = COALESCE($2, role),
         active = COALESCE($3, active),
         pin_hash = COALESCE($4, pin_hash)
       WHERE id = $5 RETURNING *`,
      [
        display_name ?? null,
        role ?? null,
        active === undefined ? null : !!active,
        pin ? hashPin(pin) : null,
        req.params.id
      ]
    );
    res.json({ user: publicUser(result.rows[0]) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update user' });
  }
});

router.delete('/users/:id', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({ error: "You can't delete your own account" });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not delete user' });
  }
});

module.exports = router;
