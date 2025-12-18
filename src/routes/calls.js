// src/routes/calls.js
const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// Get recent calls for current user
router.get('/', async (req, res) => {
  try {
    const calls = await prisma.call.findMany({
      where: {
        participants: {
          has: req.user.id,
        },
      },
      orderBy: { startTime: 'desc' },
      take: 20,
    });
    res.json(calls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;





