// src/routes/init.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const router = express.Router();
const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('[security] init route requires JWT_SECRET to be set in environment');
}
const GUEST_DOMAIN = 'guest.novabyte.local';

// Helper to generate a random password (never stored plain‑text)
function generateRandomPassword(length = 12) {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
    let pwd = '';
    for (let i = 0; i < length; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
    return pwd;
}

/**
 * Internal function that builds the same payload as the dashboard overview route.
 * It expects a userId that is already authenticated.
 */
async function buildDashboardPayload(userId) {
    // 1️⃣ Profile
    const profile = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            name: true,
            title: true,
            avatarUrl: true,
            bio: true,
            phone: true,
            location: true,
            role: { select: { name: true } },
        },
    });

    // 2️⃣ Team (all active users except self)
    const team = await prisma.user.findMany({
        where: { id: { not: userId }, status: 'ACTIVE', deletedAt: null },
        select: { id: true, name: true, title: true, avatarUrl: true, role: { select: { name: true } } },
        orderBy: { name: 'asc' },
    });

    // 3️⃣ Recent conversations (last message + unread count)
    const conversations = await prisma.conversation.findMany({
        where: { members: { some: { userId } }, deletedAt: null },
        include: {
            members: {
                where: { userId: { not: userId } },
                select: { user: { select: { id: true, name: true, avatarUrl: true } } },
            },
            messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, content: true, createdAt: true, senderId: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
    });

    // 4️⃣ Upcoming calls (status = ONGOING)
    const upcomingCalls = await prisma.call.findMany({
        where: { participants: { some: { userId } }, status: 'ONGOING', deletedAt: null },
        include: { participants: { select: { user: { select: { id: true, name: true, avatarUrl: true } } } } },
        orderBy: { startedAt: 'desc' },
        take: 5,
    });

    // 5️⃣ Latest analytics (daily row)
    const analytics = await prisma.analyticsDaily.findFirst({ orderBy: { date: 'desc' } });

    return { profile, team, conversations, upcomingCalls, analytics };
}

/**
 * GET /api/init
 * If a valid JWT is supplied, return the normal dashboard payload.
 * If no JWT (or it is invalid), automatically create a guest user,
 * issue a JWT, and return the same payload together with the token.
 */
router.get('/', async (req, res) => {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];

    // Helper to send payload + token
    const sendPayload = async (userId, jwtToken) => {
        const payload = await buildDashboardPayload(userId);
        res.json({ token: jwtToken, ...payload });
    };

    // ----------------------------------------------------------------
    // 1️⃣ If token exists, verify it first
    // ----------------------------------------------------------------
    if (token) {
        try {
            const payload = jwt.verify(token, JWT_SECRET);
            // token valid – just return dashboard data
            return await sendPayload(payload.id, token);
        } catch (e) {
            // fall through to guest creation
        }
    }

    // ----------------------------------------------------------------
    // 2️⃣ No valid token → create a guest account
    // ----------------------------------------------------------------
    if (!JWT_SECRET) return res.status(500).json({ error: 'Server misconfiguration: JWT secret not set' });

    try {
        const guestId = `guest_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const email = `${guestId}@${GUEST_DOMAIN}`;
        const password = generateRandomPassword();
        const passwordHash = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                name: 'Guest User',
                title: 'Visitor',
                avatarUrl: null,
                bio: '',
                phone: '',
                location: '',
            },
        });
        const newToken = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
        // Return the payload + the freshly created token. Do NOT expose the generated password.
        const payload = await buildDashboardPayload(user.id);
        res.json({ token: newToken, ...payload });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to initialise dashboard' });
    }
});

module.exports = router;
