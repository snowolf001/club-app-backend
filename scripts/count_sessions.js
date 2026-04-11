"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../src/db/index");
async function q() {
    const r = await index_1.db.query('SELECT COUNT(*) FROM sessions');
    console.log('Total sessions:', r.rows[0].count);
    process.exit();
}
q().catch(console.error);
