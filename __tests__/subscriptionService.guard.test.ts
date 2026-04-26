/**
 * Unit tests for the club-level active subscription guard in
 * createOrScheduleSubscriptionForClub.
 *
 * Strategy: mock every I/O boundary (pg pool, Apple/Google verify, systemEvents)
 * so tests run without a real database or network.
 */

jest.mock('../src/db', () => ({
  db: { query: jest.fn(), connect: jest.fn() },
}));
jest.mock('../src/lib/iap/appleVerify', () => ({
  verifyApplePurchase: jest.fn(),
}));
jest.mock('../src/lib/iap/googleVerify', () => ({
  verifyGooglePurchase: jest.fn(),
}));
jest.mock('../src/lib/systemEvents', () => ({
  recordSystemEvent: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { db } from '../src/db';
import { verifyApplePurchase } from '../src/lib/iap/appleVerify';
import { verifyGooglePurchase } from '../src/lib/iap/googleVerify';
import { createOrScheduleSubscriptionForClub } from '../src/services/subscriptionService';
import { AppError } from '../src/errors/AppError';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockDb = db as jest.Mocked<typeof db>;
const mockAppleVerify = verifyApplePurchase as jest.MockedFunction<typeof verifyApplePurchase>;
const mockGoogleVerify = verifyGooglePurchase as jest.MockedFunction<typeof verifyGooglePurchase>;

const CLUB_ID = 'club-uuid-001';
const MEMBER_ID = 'member-uuid-001';

type QueryRow = Record<string, unknown>;

/**
 * Build a query function that pattern-matches SQL strings to canned responses.
 * Falls through to an empty result when no pattern matches.
 */
function buildQueryFn(
  responses: Array<{ match: string | RegExp; rows: QueryRow[] }>
) {
  return jest.fn((sql: string) => {
    for (const r of responses) {
      const matched =
        typeof r.match === 'string' ? sql.includes(r.match) : r.match.test(sql);
      if (matched) {
        return Promise.resolve({ rows: r.rows, rowCount: r.rows.length });
      }
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

function makeAppleVerifyResult(overrides: Partial<{
  transactionId: string;
  originalTransactionId: string;
  expiresAtMs: number;
}> = {}) {
  return {
    valid: true,
    productId: 'passeo_pro_monthly',
    transactionId: overrides.transactionId ?? 'TXN_001',
    originalTransactionId: overrides.originalTransactionId ?? 'OTX_001',
    purchaseToken: undefined,
    orderId: undefined,
    purchaseDateMs: Date.now() - 1000,
    expiresAtMs: overrides.expiresAtMs ?? Date.now() + 60 * 60 * 1000,
    autoRenewEnabled: true,
    verificationMode: 'mock' as const,
    raw: {},
  };
}

function makeGoogleVerifyResult(overrides: Partial<{
  purchaseToken: string;
  expiresAtMs: number;
}> = {}) {
  return {
    valid: true,
    productId: 'passeo_pro_monthly',
    transactionId: undefined,
    originalTransactionId: undefined,
    purchaseToken: overrides.purchaseToken ?? 'TOKEN_001',
    orderId: 'ORDER_001',
    purchaseDateMs: Date.now() - 1000,
    expiresAtMs: overrides.expiresAtMs ?? Date.now() + 60 * 60 * 1000,
    autoRenewEnabled: true,
    verificationMode: 'mock' as const,
    raw: {},
  };
}

/** A club_subscriptions row that is currently active. */
function makeActiveRow(overrides: Partial<{
  id: string;
  original_transaction_id: string | null;
  purchase_token: string | null;
  status: string;
  transaction_id: string;
}> = {}): QueryRow {
  const now = new Date();
  return {
    id: overrides.id ?? 'sub-uuid-existing',
    club_id: CLUB_ID,
    platform: 'ios',
    plan: 'monthly',
    status: overrides.status ?? 'active',
    product_id: 'passeo_pro_monthly',
    purchased_by_membership_id: 'other-member-uuid',
    starts_at: new Date(now.getTime() - 1000).toISOString(),
    ends_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
    transaction_id: overrides.transaction_id ?? 'TXN_EXISTING',
    original_transaction_id: overrides.original_transaction_id ?? 'OTX_EXISTING',
    purchase_token: overrides.purchase_token ?? null,
    order_id: null,
    auto_renews: true,
    created_at: new Date(now.getTime() - 5000).toISOString(),
    updated_at: new Date(now.getTime() - 5000).toISOString(),
  };
}

/** Wire both the pre-transaction db.query and the transaction client. */
function setupMocks(opts: {
  memberFound?: boolean;
  /** Rows returned by fast-path idempotency check (db.query before connect) */
  fastPathRows?: QueryRow[];
  /** Responses inside the transaction client */
  clientResponses?: Array<{ match: string | RegExp; rows: QueryRow[] }>;
}) {
  const memberFound = opts.memberFound ?? true;
  const fastPathRows = opts.fastPathRows ?? [];
  const clientResponses = opts.clientResponses ?? [];

  // Pre-transaction db.query handler
  (mockDb.query as jest.Mock).mockImplementation(buildQueryFn([
    { match: 'FROM memberships', rows: memberFound ? [{ id: MEMBER_ID }] : [] },
    // fast-path idempotency (transaction_id / purchase_token)
    { match: "status NOT IN ('expired')", rows: fastPathRows },
  ]));

  // Transaction client
  const clientQuery = buildQueryFn([
    { match: 'FROM memberships', rows: memberFound ? [{ id: MEMBER_ID }] : [] },
    { match: 'FROM clubs', rows: [{ id: CLUB_ID }] },
    ...clientResponses,
  ]);

  const client = { query: clientQuery, release: jest.fn() };
  (mockDb.connect as jest.Mock).mockResolvedValue(client);

  return { client };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createOrScheduleSubscriptionForClub — club-level active subscription guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Scenario 1: clean first purchase ────────────────────────────────────────
  it('allows a first-ever purchase when club has no active subscription', async () => {
    mockAppleVerify.mockResolvedValue(makeAppleVerifyResult());

    const insertedRow = makeActiveRow({ id: 'sub-new', transaction_id: 'TXN_001', original_transaction_id: 'OTX_001' });

    const { client } = setupMocks({
      clientResponses: [
        // in-txn idempotency: no existing rows
        { match: "status NOT IN ('expired')", rows: [] },
        // club-level guard: no active row
        { match: "status IN ('active', 'canceled')", rows: [] },
        // INSERT
        { match: 'INSERT INTO club_subscriptions', rows: [insertedRow] },
        // clubs pro_status update
        { match: 'UPDATE clubs', rows: [] },
      ],
    });

    const result = await createOrScheduleSubscriptionForClub({
      clubId: CLUB_ID,
      actorMemberId: MEMBER_ID,
      platform: 'ios',
      productId: 'passeo_pro_monthly',
      receiptData: 'base64-receipt',
      transactionId: 'TXN_001',
      originalTransactionId: 'OTX_001',
    });

    expect(result.idempotent).toBe(false);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  // ── Scenario 2: same Apple transaction verified twice → idempotent ───────────
  it('returns idempotent when the same Apple transaction_id is re-verified', async () => {
    mockAppleVerify.mockResolvedValue(makeAppleVerifyResult({ transactionId: 'TXN_001' }));

    const existingRow = makeActiveRow({
      id: 'sub-existing',
      transaction_id: 'TXN_001',
      original_transaction_id: 'OTX_001',
    });

    const { client } = setupMocks({
      clientResponses: [
        // in-txn idempotency: transaction_id hit → return existing
        { match: "status NOT IN ('expired')", rows: [existingRow] },
      ],
    });

    const result = await createOrScheduleSubscriptionForClub({
      clubId: CLUB_ID,
      actorMemberId: MEMBER_ID,
      platform: 'ios',
      productId: 'passeo_pro_monthly',
      receiptData: 'base64-receipt',
      transactionId: 'TXN_001',
      originalTransactionId: 'OTX_001',
    });

    expect(result.idempotent).toBe(true);
    expect(result.subscription.id).toBe(existingRow.id);
    // Guard query must NOT have been reached
    const guardCalled = (client.query as jest.Mock).mock.calls.some(
      ([sql]: [string]) => sql.includes("status IN ('active', 'canceled')")
    );
    expect(guardCalled).toBe(false);
  });

  // ── Scenario 3: iOS renewal (new transaction_id, same original) → idempotent ─
  it('returns idempotent when iOS renewal has same original_transaction_id as active row', async () => {
    mockAppleVerify.mockResolvedValue(
      makeAppleVerifyResult({ transactionId: 'TXN_RENEWAL', originalTransactionId: 'OTX_001' })
    );

    const existingRow = makeActiveRow({
      id: 'sub-existing',
      transaction_id: 'TXN_001',
      original_transaction_id: 'OTX_001',
    });

    const { client } = setupMocks({
      clientResponses: [
        // transaction_id = TXN_RENEWAL → miss
        // Then original_transaction_id = OTX_001 → hit
        // Both conditions use the same SQL pattern "status NOT IN ('expired')"
        // so we return empty for the first call and existing for the second.
        // Jest mock implementation: first call returns empty, second returns existing.
      ],
    });

    // Override in-txn query to return empty for TXN_RENEWAL but hit for OTX_001
    let idempotencyCallCount = 0;
    (client.query as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('FROM memberships')) return Promise.resolve({ rows: [{ id: MEMBER_ID }], rowCount: 1 });
      if (sql.includes('FROM clubs')) return Promise.resolve({ rows: [{ id: CLUB_ID }], rowCount: 1 });
      if (sql.includes("status NOT IN ('expired')")) {
        idempotencyCallCount++;
        // First call: transaction_id lookup → miss; second: original_transaction_id → hit
        return idempotencyCallCount === 1
          ? Promise.resolve({ rows: [], rowCount: 0 })
          : Promise.resolve({ rows: [existingRow], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await createOrScheduleSubscriptionForClub({
      clubId: CLUB_ID,
      actorMemberId: MEMBER_ID,
      platform: 'ios',
      productId: 'passeo_pro_monthly',
      receiptData: 'base64-receipt',
      transactionId: 'TXN_RENEWAL',
      originalTransactionId: 'OTX_001',
    });

    expect(result.idempotent).toBe(true);
    expect(result.subscription.id).toBe(existingRow.id);
    // Guard must NOT have been reached (idempotent path returned early)
    const guardCalled = (client.query as jest.Mock).mock.calls.some(
      ([sql]: [string]) => sql.includes("status IN ('active', 'canceled')")
    );
    expect(guardCalled).toBe(false);
  });

  // ── Scenario 4: different Apple account → 409 ────────────────────────────────
  it('throws 409 CLUB_ALREADY_HAS_ACTIVE_SUBSCRIPTION when club has active sub from different Apple account', async () => {
    mockAppleVerify.mockResolvedValue(
      makeAppleVerifyResult({ transactionId: 'TXN_B', originalTransactionId: 'OTX_B' })
    );

    const existingActive = makeActiveRow({ id: 'sub-A', original_transaction_id: 'OTX_A' });

    setupMocks({
      clientResponses: [
        // idempotency: TXN_B and OTX_B both miss
        { match: "status NOT IN ('expired')", rows: [] },
        // guard: finds existing active row from a different identity → block
        { match: "status IN ('active', 'canceled')", rows: [existingActive] },
      ],
    });

    await expect(
      createOrScheduleSubscriptionForClub({
        clubId: CLUB_ID,
        actorMemberId: MEMBER_ID,
        platform: 'ios',
        productId: 'passeo_pro_monthly',
        receiptData: 'base64-receipt',
        transactionId: 'TXN_B',
        originalTransactionId: 'OTX_B',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CLUB_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
    });
  });

  // ── Scenario 5: different Google account → 409 ───────────────────────────────
  it('throws 409 when club has active Android sub and a different purchase_token is submitted', async () => {
    mockGoogleVerify.mockResolvedValue(
      makeGoogleVerifyResult({ purchaseToken: 'TOKEN_B' })
    );

    const existingActive = {
      ...makeActiveRow({ purchase_token: 'TOKEN_A' }),
      platform: 'android',
      original_transaction_id: null,
    };

    setupMocks({
      clientResponses: [
        { match: "status NOT IN ('expired')", rows: [] },
        { match: "status IN ('active', 'canceled')", rows: [existingActive] },
      ],
    });

    await expect(
      createOrScheduleSubscriptionForClub({
        clubId: CLUB_ID,
        actorMemberId: MEMBER_ID,
        platform: 'android',
        productId: 'passeo_pro_monthly',
        purchaseToken: 'TOKEN_B',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CLUB_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
    });
  });

  // ── Scenario 6: expired existing → new purchase allowed ──────────────────────
  it('allows a new purchase when the existing row is expired', async () => {
    mockAppleVerify.mockResolvedValue(
      makeAppleVerifyResult({ transactionId: 'TXN_NEW', originalTransactionId: 'OTX_NEW' })
    );

    const newRow = makeActiveRow({ id: 'sub-new', transaction_id: 'TXN_NEW', original_transaction_id: 'OTX_NEW' });

    setupMocks({
      clientResponses: [
        // idempotency: miss (expired row excluded by NOT IN ('expired'))
        { match: "status NOT IN ('expired')", rows: [] },
        // guard: no currently active row
        { match: "status IN ('active', 'canceled')", rows: [] },
        // INSERT
        { match: 'INSERT INTO club_subscriptions', rows: [newRow] },
        { match: 'UPDATE clubs', rows: [] },
      ],
    });

    const result = await createOrScheduleSubscriptionForClub({
      clubId: CLUB_ID,
      actorMemberId: MEMBER_ID,
      platform: 'ios',
      productId: 'passeo_pro_monthly',
      receiptData: 'base64-receipt',
      transactionId: 'TXN_NEW',
      originalTransactionId: 'OTX_NEW',
    });

    expect(result.idempotent).toBe(false);
  });

  // ── Scenario 7: active_cancelled blocks duplicate ─────────────────────────────
  it('throws 409 when club sub has status=canceled (still within entitled period)', async () => {
    mockAppleVerify.mockResolvedValue(
      makeAppleVerifyResult({ transactionId: 'TXN_B', originalTransactionId: 'OTX_B' })
    );

    const canceledActive = makeActiveRow({
      id: 'sub-canceled',
      original_transaction_id: 'OTX_A',
      status: 'canceled',
    });

    setupMocks({
      clientResponses: [
        { match: "status NOT IN ('expired')", rows: [] },
        // guard: finds canceled-but-still-active row → block
        { match: "status IN ('active', 'canceled')", rows: [canceledActive] },
      ],
    });

    await expect(
      createOrScheduleSubscriptionForClub({
        clubId: CLUB_ID,
        actorMemberId: MEMBER_ID,
        platform: 'ios',
        productId: 'passeo_pro_monthly',
        receiptData: 'base64-receipt',
        transactionId: 'TXN_B',
        originalTransactionId: 'OTX_B',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'CLUB_ALREADY_HAS_ACTIVE_SUBSCRIPTION',
    });
  });

  // ── Scenario 8: provider verify fails → 402, no guard reached ────────────────
  it('throws 402 and never reaches the guard when provider verify returns invalid', async () => {
    mockAppleVerify.mockResolvedValue({
      valid: false,
      productId: 'passeo_pro_monthly',
      transactionId: undefined,
      originalTransactionId: undefined,
      purchaseToken: undefined,
      orderId: undefined,
      purchaseDateMs: undefined,
      expiresAtMs: undefined,
      autoRenewEnabled: undefined,
      verificationMode: 'real' as const,
      raw: {},
      errorCode: 'VERIFY_RESULT_INVALID',
      errorMessage: 'Receipt is invalid',
    });

    setupMocks({});

    await expect(
      createOrScheduleSubscriptionForClub({
        clubId: CLUB_ID,
        actorMemberId: MEMBER_ID,
        platform: 'ios',
        productId: 'passeo_pro_monthly',
        receiptData: 'bad-receipt',
        transactionId: 'TXN_X',
        originalTransactionId: 'OTX_X',
      })
    ).rejects.toMatchObject({
      statusCode: 402,
      code: 'PAYMENT_REQUIRED',
    });
  });
});
