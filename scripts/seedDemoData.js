"use strict";
/**
 * Demo data seed script — "Mile High Fitness Club"
 *
 * Generates realistic data for screenshots, reports, and marketing.
 * Safe to re-run: deletes the previous demo club and recreates it fresh.
 *
 * Usage:
 *   npm run seed:demo
 */
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const pg_1 = require("pg");
const crypto_1 = require("crypto");
// ── DB connection ─────────────────────────────────────────────────────────────
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});
// ── Helpers ───────────────────────────────────────────────────────────────────
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
function makeRecoveryCode() {
    const seg = () => randomInt(0, 0xffff).toString(16).toUpperCase().padStart(4, '0');
    return `${seg()}-${seg()}-${seg()}`;
}
/** Returns a Date N days in the past (time component preserved for further adjustment). */
function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
}
// ── Batch insert helper ───────────────────────────────────────────────────────
async function batchInsert(table, columns, rows, chunkSize = 200) {
    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const values = [];
        const placeholders = chunk.map((row) => {
            const offset = values.length + 1;
            values.push(...row);
            return `(${row.map((_, k) => `$${offset + k}`).join(', ')})`;
        });
        await pool.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`, values);
    }
}
// ── Static data ───────────────────────────────────────────────────────────────
const CLUB_NAME = 'Mile High Fitness Club';
const JOIN_CODE = 'MHFC2024';
const LOCATIONS = [
    { name: 'Main Gym', address: '1234 Fitness Ave' },
    { name: 'Downtown Studio', address: '456 Center St' },
    { name: 'Outdoor Court', address: '789 Park Blvd' },
    { name: 'Community Center', address: '321 Community Dr' },
    { name: 'East Side Hall', address: '654 East Side Rd' },
    { name: 'West End Field', address: '987 West End Lane' },
];
const MEMBER_NAMES = [
    'Alex Chen',
    'Sarah Kim',
    'David Wang',
    'Emily Zhang',
    'Michael Lee',
    'Jessica Liu',
    'Kevin Zhao',
    'Rachel Lin',
    'Daniel Wu',
    'Chris Park',
    'Sophia Huang',
    'Jason Xu',
    'Angela Sun',
    'Brian Ho',
    'Tony Li',
    'Cindy Zhou',
    'Eric Gao',
    'Nina Tang',
    'Victor Shen',
    'Lisa Qian',
    'Marcus Johnson',
    'Priya Patel',
    'Omar Hassan',
    'Yuki Tanaka',
    'Sofia Rodriguez',
    'James Williams',
    'Aisha Thompson',
    'Lucas Brown',
    'Maya Anderson',
    'Ryan Garcia',
];
// index 0 → owner, 1–2 → host, 3+ → member
// (schema only allows 'member' | 'host' | 'owner')
function roleForIndex(i) {
    if (i === 0)
        return 'owner';
    if (i <= 2)
        return 'host';
    return 'member';
}
const SESSION_TITLES = [
    'Morning Training',
    'Evening Workout',
    'Weekend Bootcamp',
    'Core & Cardio',
    'Strength Training',
    'HIIT Session',
    'Yoga & Flexibility',
    'Team Drills',
    'Endurance Run',
    'Open Gym',
    'Skills Workshop',
    'Recovery Session',
    'Power Hour',
    'Group Fitness',
    'Circuit Training',
];
// Realistic time slots (hour, minute)
const TIME_SLOTS = [
    { hour: 6, minute: 0 }, // 6:00 AM
    { hour: 7, minute: 30 }, // 7:30 AM
    { hour: 9, minute: 0 }, // 9:00 AM
    { hour: 12, minute: 0 }, // 12:00 PM
    { hour: 17, minute: 30 }, // 5:30 PM
    { hour: 18, minute: 30 }, // 6:30 PM
    { hour: 19, minute: 0 }, // 7:00 PM
    { hour: 20, minute: 0 }, // 8:00 PM
];
// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`\nSeeding "${CLUB_NAME}"...\n`);
    // ── Step 1: Clean up any existing demo club ──────────────────────────────
    const { rows: existing } = await pool.query('SELECT id FROM clubs WHERE name = $1', [CLUB_NAME]);
    if (existing.length > 0) {
        const oldId = existing[0].id;
        const { rows: memberRows } = await pool.query('SELECT user_id FROM memberships WHERE club_id = $1', [oldId]);
        const userIds = memberRows.map((r) => r.user_id);
        // CASCADE on clubs deletes: memberships, sessions, attendances,
        // credit_transactions, club_locations
        await pool.query('DELETE FROM clubs WHERE id = $1', [oldId]);
        if (userIds.length > 0) {
            await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
                userIds,
            ]);
        }
        console.log(`  Removed existing demo club (${oldId}) and its data.`);
    }
    // ── Step 2: Club ─────────────────────────────────────────────────────────
    const clubId = (0, crypto_1.randomUUID)();
    await pool.query(`INSERT INTO clubs
       (id, name, join_code, allow_member_backfill, member_backfill_hours, host_backfill_hours)
     VALUES ($1, $2, $3, true, 24, 72)`, [clubId, CLUB_NAME, JOIN_CODE]);
    console.log(`[1/5] Club created: ${CLUB_NAME} (${clubId})`);
    // ── Step 3: Locations ────────────────────────────────────────────────────
    const locationIds = LOCATIONS.map(() => (0, crypto_1.randomUUID)());
    await batchInsert('club_locations', ['id', 'club_id', 'name', 'address'], LOCATIONS.map((loc, i) => [locationIds[i], clubId, loc.name, loc.address]));
    console.log(`[2/5] ${locationIds.length} locations created`);
    const members = MEMBER_NAMES.map((name, i) => ({
        userId: (0, crypto_1.randomUUID)(),
        membershipId: (0, crypto_1.randomUUID)(),
        name,
        role: roleForIndex(i),
        initialCredits: randomInt(60, 100),
    }));
    // Batch: users
    await batchInsert('users', ['id', 'name', 'email'], members.map((m) => [
        m.userId,
        m.name,
        `${m.name.toLowerCase().replace(/\s+/g, '.')}.demo@example.com`,
    ]));
    // Batch: memberships
    await batchInsert('memberships', [
        'id',
        'club_id',
        'user_id',
        'role',
        'status',
        'credits_remaining',
        'recovery_code',
        'display_name',
    ], members.map((m) => [
        m.membershipId,
        clubId,
        m.userId,
        m.role,
        'active',
        m.initialCredits,
        makeRecoveryCode(),
        m.name,
    ]));
    // Batch: initial credit grant transactions
    await batchInsert('credit_transactions', [
        'id',
        'club_id',
        'membership_id',
        'user_id',
        'actor_user_id',
        'amount',
        'transaction_type',
        'note',
    ], members.map((m) => [
        (0, crypto_1.randomUUID)(),
        clubId,
        m.membershipId,
        m.userId,
        m.userId,
        m.initialCredits,
        'add',
        'Initial demo credits',
    ]));
    console.log(`[3/5] ${members.length} members created`);
    const sessions = [];
    const sessionRows = [];
    // Past sessions
    for (let week = 51; week >= 0 && sessions.length < 100; week--) {
        const perWeek = randomInt(1, 3);
        const weekDays = shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, perWeek);
        for (const dayOfWeek of weekDays) {
            if (sessions.length >= 100)
                break;
            const daysBack = week * 7 + dayOfWeek + 1; // always >= 1
            const slot = pickRandom(TIME_SLOTS);
            const startsAt = daysAgo(daysBack);
            startsAt.setHours(slot.hour, slot.minute, 0, 0);
            const endsAt = new Date(startsAt.getTime() + randomInt(60, 120) * 60000);
            const sessionId = (0, crypto_1.randomUUID)();
            sessions.push({ id: sessionId, startsAt });
            sessionRows.push([
                sessionId,
                clubId,
                pickRandom(SESSION_TITLES),
                startsAt,
                endsAt,
                pickRandom(locationIds),
                startsAt,
                startsAt, // created_at, updated_at
            ]);
        }
    }
    // Upcoming sessions (next 4 weeks, ~2-3 per week)
    for (let week = 0; week < 4; week++) {
        const perWeek = randomInt(2, 3);
        const weekDays = shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, perWeek);
        for (const dayOfWeek of weekDays) {
            const daysAhead = week * 7 + dayOfWeek + 1; // always >= 1 day ahead
            const slot = pickRandom(TIME_SLOTS);
            const startsAt = new Date();
            startsAt.setDate(startsAt.getDate() + daysAhead);
            startsAt.setHours(slot.hour, slot.minute, 0, 0);
            const sessionId = (0, crypto_1.randomUUID)();
            sessions.push({ id: sessionId, startsAt });
            sessionRows.push([
                sessionId,
                clubId,
                pickRandom(SESSION_TITLES),
                startsAt,
                null, // no end time for upcoming sessions
                pickRandom(locationIds),
                new Date(),
                new Date(),
            ]);
        }
    }
    await batchInsert('sessions', [
        'id',
        'club_id',
        'title',
        'starts_at',
        'ends_at',
        'location_id',
        'created_at',
        'updated_at',
    ], sessionRows);
    console.log(`[4/5] ${sessions.length} sessions created`);
    // ── Step 6: Attendances + check-in credit transactions ───────────────────
    const attendanceRows = [];
    const checkinTxRows = [];
    const checkinCount = new Map(members.map((m) => [m.membershipId, 0]));
    for (const session of sessions) {
        const count = randomInt(5, Math.min(20, members.length));
        const attendees = shuffle(members).slice(0, count);
        for (const member of attendees) {
            const attId = (0, crypto_1.randomUUID)();
            const checkedInAt = new Date(session.startsAt.getTime() + randomInt(0, 30) * 60000);
            attendanceRows.push([
                attId,
                session.id,
                clubId,
                member.userId,
                member.membershipId,
                'self', // check_in_method
                checkedInAt,
                1, // credits_used
                member.userId, // checked_in_by_user_id (self check-in)
            ]);
            checkinTxRows.push([
                (0, crypto_1.randomUUID)(),
                clubId,
                member.membershipId,
                member.userId,
                member.userId, // actor_user_id
                session.id,
                attId,
                -1,
                'checkin',
                'Session check-in',
            ]);
            checkinCount.set(member.membershipId, (checkinCount.get(member.membershipId) ?? 0) + 1);
        }
    }
    await batchInsert('attendances', [
        'id',
        'session_id',
        'club_id',
        'user_id',
        'membership_id',
        'check_in_method',
        'checked_in_at',
        'credits_used',
        'checked_in_by_user_id',
    ], attendanceRows);
    await batchInsert('credit_transactions', [
        'id',
        'club_id',
        'membership_id',
        'user_id',
        'actor_user_id',
        'session_id',
        'attendance_id',
        'amount',
        'transaction_type',
        'note',
    ], checkinTxRows);
    console.log(`[5/5] ${attendanceRows.length} check-ins created`);
    // ── Step 7: Update credits_remaining ─────────────────────────────────────
    //   final balance = initial_credits - check-ins (floor 0)
    for (const member of members) {
        const used = checkinCount.get(member.membershipId) ?? 0;
        const remaining = Math.max(0, member.initialCredits - used);
        await pool.query('UPDATE memberships SET credits_remaining = $1 WHERE id = $2', [remaining, member.membershipId]);
    }
    // ── Summary ──────────────────────────────────────────────────────────────
    console.log(`
Seed complete: ${members.length} members, ${sessions.length} sessions, ${attendanceRows.length} check-ins
Club:      "${CLUB_NAME}"
Join code: ${JOIN_CODE}
Club ID:   ${clubId}
`);
}
main()
    .catch((err) => {
    console.error('\nSeed failed:', err);
    process.exit(1);
})
    .finally(() => pool.end());
