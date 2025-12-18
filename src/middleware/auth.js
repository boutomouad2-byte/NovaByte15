// src/middleware/auth.js
const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.warn('[security] JWT_SECRET is not set. Define a strong secret in your .env file.');
}

/**
 * Verify JWT token for HTTP requests.
 * If verification fails, respond with 401.
 */
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Missing token' });
    if (!JWT_SECRET) {
        return res.status(500).json({ error: 'Server misconfiguration: JWT secret not set' });
    }
    jwt.verify(token, JWT_SECRET, (err, payload) => {
        if (err) return res.status(401).json({ error: 'Invalid token' });
        req.user = payload; // payload contains at least { id, email }
        next();
    });
}

/**
 * Verify token for Socket.io handshake.
 * Returns payload or throws.
 */
function verifyTokenSocket(token, returnPayload = false) {
    return new Promise((resolve, reject) => {
        if (!JWT_SECRET) {
            return reject(new Error('JWT secret not set'));
        }
        jwt.verify(token, JWT_SECRET, (err, payload) => {
            if (err) return reject(err);
            if (returnPayload) return resolve(payload);
            resolve(true);
        });
    });
}

module.exports = { verifyToken, verifyTokenSocket };
