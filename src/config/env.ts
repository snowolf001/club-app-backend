import dotenv from 'dotenv';

dotenv.config();

export const port: number = parseInt(process.env.PORT ?? '3000', 10);
export const databaseUrl: string | undefined = process.env.DATABASE_URL;

// ─── Apple IAP / Server Notifications ────────────────────────────────────────
// APPLE_SHARED_SECRET   — App-specific shared secret from App Store Connect.
//                         Required for verifyReceipt (the current verify flow).
//                         Not needed if IAP_MOCK_ENABLED=true.
//
// APPLE_BUNDLE_ID       — App bundle identifier (e.g. 'com.example.passeo').
//                         Used to validate the bundleId claim in App Store Server
//                         Notifications. Optional but recommended in production.
//
// IAP_MOCK_ENABLED      — Set to 'true' ONLY for local/closed-testing.
//                         Bypasses Apple receipt verification entirely.
//                         Must be unset or 'false' in production.

// ─── Google Play / RTDN ───────────────────────────────────────────────────────
// GOOGLE_SERVICE_ACCOUNT_KEY   — Service account JSON (raw or file path).
// GOOGLE_PLAY_PACKAGE_NAME     — Android app package name.
// GOOGLE_RTDN_WEBHOOK_TOKEN    — Shared token appended to RTDN push URL.
// GOOGLE_PUBSUB_VERIFIER_AUDIENCE — Expected JWT audience for Pub/Sub OIDC.
// GOOGLE_PUBSUB_VERIFIER_EMAIL    — Expected service-account email in Pub/Sub JWT.
