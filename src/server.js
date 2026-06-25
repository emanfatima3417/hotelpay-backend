// server.js — entry point. Wires up middleware and routes.
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { initSchema } = require('./db');
const authRoutes = require('./routes/auth');
const txRoutes = require('./routes/transactions');
const aiRoutes = require('./routes/ai');

const app = express();

// Screenshot images are sent as base64 inside JSON, so allow a generous body size.
app.use(express.json({ limit: '15mb' }));
app.use(cors()); // the phone app and backend are served from different origins

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/transactions', txRoutes);
app.use('/api/ai', aiRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Catch-all error handler so a thrown error returns JSON, not an HTML stack trace.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`HotelPay backend running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
