// routes/transactions.js — CRUD for payment records, with role-based visibility:
// owner & manager see everything; employee sees only what they personally created.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../auth');

function publicId() {
  return 'T' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function canSeeAll(role) {
  return role === 'owner' || role === 'manager';
}

// List + filter. Employees automatically scoped to their own records server-side
// (not just hidden in the UI) so there's no way to see others' data by editing requests.
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category, bank, date, q } = req.query;
    let sql = 'SELECT t.*, u.display_name as created_by_name FROM transactions t JOIN users u ON u.id = t.created_by WHERE 1=1';
    const params = [];
    let i = 1;

    if (!canSeeAll(req.user.role)) {
      sql += ` AND t.created_by = $${i++}`;
      params.push(req.user.id);
    }
    if (category) { sql += ` AND t.category = $${i++}`; params.push(category); }
    if (bank) { sql += ` AND t.bank = $${i++}`; params.push(bank); }
    if (date) { sql += ` AND t.date = $${i++}`; params.push(date); }
    if (q) {
      sql += ` AND (t.sender ILIKE $${i} OR t.receiver ILIKE $${i} OR t.purpose ILIKE $${i} OR t.public_id ILIKE $${i})`;
      params.push(`%${q}%`); i++;
    }
    sql += ' ORDER BY t.date DESC, t.id DESC';

    const result = await pool.query(sql, params);
    res.json({ transactions: result.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load transactions' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { sender, receiver, amount, bank, category, date, purpose, note, image_data } = req.body;
    if (!sender || !String(sender).trim()) {
      return res.status(400).json({ error: 'Sender name is required' });
    }
    const id = publicId();
    await pool.query(
      `INSERT INTO transactions
        (public_id, sender, receiver, amount, bank, category, date, purpose, note, image_data, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        String(sender).trim(),
        receiver || 'Hotel Account',
        parseFloat(amount) || 0,
        bank || 'Unknown',
        category || 'Miscellaneous',
        date || new Date().toISOString().split('T')[0],
        purpose || '',
        note || '',
        image_data || null,
        req.user.id
      ]
    );
    const result = await pool.query(
      'SELECT t.*, u.display_name as created_by_name FROM transactions t JOIN users u ON u.id=t.created_by WHERE t.public_id = $1',
      [id]
    );
    res.json({ transaction: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save transaction' });
  }
});

async function loadOwned(req, res, next) {
  try {
    const result = await pool.query('SELECT * FROM transactions WHERE public_id = $1', [req.params.id]);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Transaction not found' });
    if (!canSeeAll(req.user.role) && row.created_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own uploads' });
    }
    req.tx = row;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load transaction' });
  }
}

router.patch('/:id', requireAuth, loadOwned, async (req, res) => {
  try {
    const { sender, receiver, amount, bank, category, date, purpose, note } = req.body;
    await pool.query(
      `UPDATE transactions SET
         sender = COALESCE($1, sender), receiver = COALESCE($2, receiver),
         amount = COALESCE($3, amount), bank = COALESCE($4, bank),
         category = COALESCE($5, category), date = COALESCE($6, date),
         purpose = COALESCE($7, purpose), note = COALESCE($8, note),
         updated_at = now()
       WHERE public_id = $9`,
      [
        sender ?? null, receiver ?? null,
        amount === undefined ? null : parseFloat(amount),
        bank ?? null, category ?? null, date ?? null, purpose ?? null, note ?? null,
        req.params.id
      ]
    );
    const result = await pool.query(
      'SELECT t.*, u.display_name as created_by_name FROM transactions t JOIN users u ON u.id=t.created_by WHERE t.public_id = $1',
      [req.params.id]
    );
    res.json({ transaction: result.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update transaction' });
  }
});

router.delete('/:id', requireAuth, loadOwned, async (req, res) => {
  try {
    if (!canSeeAll(req.user.role) && req.tx.created_by !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own uploads' });
    }
    await pool.query('DELETE FROM transactions WHERE public_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not delete transaction' });
  }
});

module.exports = router;
