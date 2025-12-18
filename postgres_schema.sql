-- PostgreSQL schema for NovaByte backend
-- This mirrors the Prisma models in prisma/schema.prisma
-- Use with:  psql -d your_database -f backend/postgres_schema.sql

-- ========== ENUMS ==========

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'calltype') THEN
        CREATE TYPE "CallType" AS ENUM ('AUDIO', 'VIDEO');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'callstatus') THEN
        CREATE TYPE "CallStatus" AS ENUM ('ONGOING', 'COMPLETED', 'MISSED');
    END IF;
END$$;

-- ========== TABLES ==========

-- Users
CREATE TABLE IF NOT EXISTS "User" (
    id              SERIAL PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    "passwordHash"  TEXT NOT NULL,
    name            TEXT NOT NULL,
    title           TEXT,
    "avatarUrl"     TEXT,
    bio             TEXT,
    phone           TEXT,
    location        TEXT,
    role            TEXT NOT NULL DEFAULT 'user',
    "isActive"      BOOLEAN NOT NULL DEFAULT TRUE,
    "deletedAt"     TIMESTAMPTZ,
    "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Messages
CREATE TABLE IF NOT EXISTS "Message" (
    id          SERIAL PRIMARY KEY,
    "senderId"  INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    "receiverId"INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Message_senderId_idx" ON "Message"("senderId");
CREATE INDEX IF NOT EXISTS "Message_receiverId_idx" ON "Message"("receiverId");
CREATE INDEX IF NOT EXISTS "Message_createdAt_idx" ON "Message"("createdAt");

-- Calls
CREATE TABLE IF NOT EXISTS "Call" (
    id           SERIAL PRIMARY KEY,
    title        TEXT NOT NULL,
    participants INTEGER[] NOT NULL DEFAULT '{}', -- array of User IDs
    "startTime"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration     INTEGER NOT NULL DEFAULT 0,
    type         "CallType" NOT NULL DEFAULT 'AUDIO',
    status       "CallStatus" NOT NULL DEFAULT 'ONGOING'
);

CREATE INDEX IF NOT EXISTS "Call_startTime_idx" ON "Call"("startTime");
CREATE INDEX IF NOT EXISTS "Call_status_idx" ON "Call"(status);

-- Notifications
CREATE TABLE IF NOT EXISTS "Notification" (
    id          SERIAL PRIMARY KEY,
    "userId"    INTEGER NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    read        BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId");
CREATE INDEX IF NOT EXISTS "Notification_read_idx" ON "Notification"(read);

-- Analytics
CREATE TABLE IF NOT EXISTS "Analytics" (
    id               SERIAL PRIMARY KEY,
    "systemHealth"   DOUBLE PRECISION NOT NULL DEFAULT 100,
    "teamProductivity" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "userId"         INTEGER REFERENCES "User"(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "Analytics_userId_idx" ON "Analytics"("userId");

-- ========== TRIGGERS ==========

-- Keep updatedAt in sync on User updates
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'set_user_updated_at'
    ) THEN
        CREATE TRIGGER set_user_updated_at
        BEFORE UPDATE ON "User"
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
    END IF;
END$$;





