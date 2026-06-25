// auth.js — password (PIN) hashing and JWT session tokens.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail loudly rather than silently running with an insecure default.
  console.error('FATAL: JWT_SECRET environment variable is not set. See .env.example.');
  process.exit(1);
}

const TOKEN_EXPIRY = '30d'; // employees shouldn't have to re-login constantly

function hashPin(pin) {
  return bcrypt.hashSync(String(pin), 10);
}

function verifyPin(pin, hash) {
  return bcrypt.compareSync(String(pin), hash);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Express middleware: requires a valid Bearer token, attaches req.user.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing authentication token' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired session, please log in again' });
  req.user = payload;
  next();
}

// Express middleware factory: requires one of the given roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do that' });
    }
    next();
  };
}

module.exports = { hashPin, verifyPin, signToken, verifyToken, requireAuth, requireRole };
