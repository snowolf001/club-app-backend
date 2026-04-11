"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../src/db/index");
async function q() {
    const r = await index_1.db.query('SELECT starts_at, ends_at FROM sessions ORDER BY starts_at ASC LIMIT 5');
    console.log(r.rows);
    const r2 = await index_1.db.query('SELECT starts_at, ends_at FROM sessions ORDER BY starts_at DESC LIMIT 5');
    console.log(r2.rows);
    process.exit();
}
q().catch(console.error);
