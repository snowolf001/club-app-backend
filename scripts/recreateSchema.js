"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const index_1 = require("../src/db/index");
async function main() {
    console.log('--- DB SCHEMA RECREATION (DANGER) ---');
    try {
        console.log('1. Dropping existing sub-schemas and recreating...');
        await index_1.db.query(`DROP SCHEMA public CASCADE;`);
        await index_1.db.query(`CREATE SCHEMA public;`);
        await index_1.db.query(`GRANT ALL ON SCHEMA public TO postgres;`);
        await index_1.db.query(`GRANT ALL ON SCHEMA public TO public;`);
        console.log('2. Running 001_initial_schema.sql...');
        const schemaPath = path_1.default.join(__dirname, '../sql/migrations/001_initial_schema.sql');
        const schemaSql = fs_1.default.readFileSync(schemaPath, 'utf8');
        // Split statements or run directly; pg pool.query handles multiple statements ok.
        await index_1.db.query(schemaSql);
        console.log('✅ Base schema successfully generated and columns verified!');
    }
    catch (error) {
        console.error('❌ Failed to run schema reset:', error);
        process.exit(1);
    }
    finally {
        // End the pool so the script exits
        await index_1.db.end();
        process.exit(0);
    }
}
main();
