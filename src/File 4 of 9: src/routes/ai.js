// routes/ai.js — proxies AI requests through the backend so the Anthropic
// API key lives only here (as a server environment variable), never inside
// the phone app where it could be extracted and misused.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth');

const CATEGORIES_PROMPT = 'Utility Bills,Staff Salaries,Food & Supplies,Maintenance,Room Booking,Vendor Payments,Miscellaneous';

function getApiKey() {
  return process.env.ANTHROPIC_API_KEY || null;
}

async function callClaude(body) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('AI features are not set up yet. Ask your administrator to add the API key on the server.');
    err.code = 'NO_KEY';
    throw err;
  }
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await resp.json();
  if (data.error) {
    const err = new Error(data.error.message || 'AI request failed');
    throw err;
  }
  return data;
}

// --- Extract structured payment data from a screenshot ---
// Expects { image_base64, media_type } in the body.
router.post('/extract', requireAuth, async (req, res) => {
  const { image_base64, media_type } = req.body;
  if (!image_base64) return res.status(400).json({ error: 'No image provided' });
  try {
    const data = await callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media_type || 'image/jpeg', data: image_base64 } },
          { type: 'text', text: `Extract payment data from this screenshot. Respond ONLY with a JSON object, no backticks or markdown.\n{"sender_name":"","receiver_name":"","amount":"e.g. PKR 5000","date":"YYYY-MM-DD","time":"","transaction_id":"","bank_or_app":"","payment_purpose":"","category":"one of: ${CATEGORIES_PROMPT}","confidence":"High/Medium/Low","notes":""}` }
        ]
      }]
    });
    const text = data.content?.find(c => c.type === 'text')?.text || '{}';
    let parsed = {};
    try { parsed = JSON.parse(text.replace(/```[\w]*/g, '').replace(/```/g, '').trim()); } catch (e) {}
    res.json({ extracted: parsed });
  } catch (e) {
    res.status(e.code === 'NO_KEY' ? 503 : 500).json({ error: e.message });
  }
});

// --- AI chat about the user's visible transactions ---
// Expects { question, history, transactions_summary } in the body.
router.post('/chat', requireAuth, async (req, res) => {
  const { question, history, transactions_summary } = req.body;
  if (!question) return res.status(400).json({ error: 'No question provided' });
  try {
    const data = await callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: `You are a hotel payment assistant. Transactions:\n${transactions_summary || ''}\nAnswer concisely in 2-4 sentences. Include specific amounts and names.`,
      messages: [...(Array.isArray(history) ? history : []), { role: 'user', content: question }]
    });
    const text = data.content?.find(c => c.type === 'text')?.text || 'Sorry, could not process that.';
    res.json({ answer: text });
  } catch (e) {
    res.status(e.code === 'NO_KEY' ? 503 : 500).json({ error: e.message });
  }
});

module.exports = router;
