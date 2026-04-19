import { OAuth2Client } from 'google-auth-library';
import { db } from '../db';
import { logger } from '../lib/logger';
import { verifyGooglePurchase } from '../lib/iap/googleVerify';
import { recordSystemEvent } from '../lib/systemEvents';

interface PubSubPushEnvelope {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
    attributes?: Record<string, string>;
  };
  subscription?: string;
}

interface GooglePlayDeveloperNotification {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  subscriptionNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    subscriptionId?: string;
  };
  testNotification?: {
    version?: string;
  };
  // Google also sends these notification types via RTDN.
  // We do not process them, but we must recognise them to avoid logging false failures.
  oneTimeProductNotification?: {
    version?: string;
    notificationType?: number;
    purchaseToken?: string;
    sku?: string;
  };
  voidedPurchaseNotification?: {
    purchaseToken?: string;
    orderId?: string;
    productType?: number; // 1 = in-app, 2 = subscription
    refundType?: number; // 1 = full-content, 2 = quantity-based
  };
  [key: string]: unknown;
}

// All recognised top-level RTDN notification type keys.
// Used to identify unknown future types for logging.
const KNOWN_NOTIFICATION_KEYS = [
  'subscriptionNotification',
  'testNotification',
  'oneTimeProductNotification',
  'voidedPurchaseNotification',
] as const;

type RtdnNotificationType =
  | 'subscription'
  | 'test'
  | 'one_time_product'
  | 'voided_purchase'
  | 'unknown';

function classifyRtdnPayload(
  payload: GooglePlayDeveloperNotification
): RtdnNotificationType {
  if (payload.subscriptionNotification) return 'subscription';
  if (payload.testNotification) return 'test';
  if (payload.oneTimeProductNotification) return 'one_time_product';
  if (payload.voidedPurchaseNotification) return 'voided_purchase';
  return 'unknown';
}

function safePayloadTopLevelKeys(
  payload: GooglePlayDeveloperNotification
): string[] {
  // Return only non-standard top-level keys (i.e. anything beyond the known set
  // plus version/packageName/eventTimeMillis) to help diagnose future unknowns.
  const standard = new Set([
    'version',
    'packageName',
    'eventTimeMillis',
    ...KNOWN_NOTIFICATION_KEYS,
  ]);
  return Object.keys(payload).filter((k) => !standard.has(k));
}

const pubsubJwtClient = new OAuth2Client();

// Simple in-memory dedupe cache for one process.
// Good enough for MVP + closed testing. DB event table is the durable audit trail.
const processedMessageIds = new Map<string, number>();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function cleanupProcessedMessageIds(): void {
  const now = Date.now();
  for (const [messageId, expiresAt] of processedMessageIds.entries()) {
    if (expiresAt <= now) {
      processedMessageIds.delete(messageId);
    }
  }
}

function wasMessageProcessed(messageId: string): boolean {
  cleanupProcessedMessageIds();
  const expiresAt = processedMessageIds.get(messageId);
  return !!expiresAt && expiresAt > Date.now();
}

function markMessageProcessed(messageId: string): void {
  cleanupProcessedMessageIds();
  processedMessageIds.set(messageId, Date.now() + 24 * 60 * 60 * 1000);
}

function decodePubSubMessage(data: string): GooglePlayDeveloperNotification {
  const json = Buffer.from(data, 'base64').toString('utf8');
  return JSON.parse(json) as GooglePlayDeveloperNotification;
}

function toDateOrNull(ms?: number): Date | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms) : null;
}

function mapGoogleStateToDbStatus(
  raw: unknown,
  valid: boolean
): 'active' | 'expired' | 'canceled' {
  if (valid) {
    return 'active';
  }

  const subscriptionState =
    raw &&
    typeof raw === 'object' &&
    'subscriptionState' in raw &&
    typeof (raw as { subscriptionState?: unknown }).subscriptionState ===
      'string'
      ? (raw as { subscriptionState: string }).subscriptionState
      : undefined;

  switch (subscriptionState) {
    case 'SUBSCRIPTION_STATE_CANCELED':
      return 'canceled';
    case 'SUBSCRIPTION_STATE_EXPIRED':
      return 'expired';
    default:
      return 'expired';
  }
}

export function parsePubSubEnvelope(body: unknown): PubSubPushEnvelope {
  if (!body || typeof body !== 'object') {
    throw new Error('Invalid Pub/Sub body');
  }

  return body as PubSubPushEnvelope;
}

export function verifyWebhookToken(tokenFromQuery: unknown): void {
  const expected = requireEnv('GOOGLE_RTDN_WEBHOOK_TOKEN');
  const actual = typeof tokenFromQuery === 'string' ? tokenFromQuery : '';

  if (!actual || actual !== expected) {
    throw new Error('Invalid webhook token');
  }
}

export async function verifyPubSubPushJwt(
  authHeader: string | undefined
): Promise<void> {
  const expectedAudience = requireEnv('GOOGLE_PUBSUB_VERIFIER_AUDIENCE');
  const expectedEmail = requireEnv('GOOGLE_PUBSUB_VERIFIER_EMAIL');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing Pub/Sub bearer token');
  }

  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    throw new Error('Empty Pub/Sub bearer token');
  }

  const ticket = await pubsubJwtClient.verifyIdToken({
    idToken,
    audience: expectedAudience,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error('Missing Pub/Sub JWT payload');
  }

  if (payload.email !== expectedEmail) {
    throw new Error(
      `Unexpected Pub/Sub JWT email: expected ${expectedEmail}, got ${payload.email ?? 'UNKNOWN'}`
    );
  }

  if (payload.email_verified !== true) {
    throw new Error('Pub/Sub JWT email is not verified');
  }
}

interface UpdateSubscriptionFromWebhookInput {
  productId: string;
  purchaseToken: string;
  notificationType: number | null;
  eventTimeMillis: string | null;
  verifyResult: {
    valid: boolean;
    productId: string;
    purchaseToken?: string;
    orderId?: string;
    purchaseDateMs?: number;
    expiresAtMs?: number;
    errorMessage?: string;
    raw?: unknown;
  };
}

async function insertWebhookEvent(params: {
  messageId: string | null;
  payload: GooglePlayDeveloperNotification;
  productId: string | null;
  purchaseToken: string | null;
  notificationType: number | null;
}): Promise<void> {
  const eventTime = params.payload.eventTimeMillis
    ? new Date(Number(params.payload.eventTimeMillis))
    : new Date();

  await db.query(
    `
    INSERT INTO subscription_webhook_events (
      provider,
      message_id,
      package_name,
      product_id,
      purchase_token,
      notification_type,
      event_time,
      payload
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    ON CONFLICT (message_id) DO NOTHING
    `,
    [
      'google',
      params.messageId,
      params.payload.packageName ?? null,
      params.productId,
      params.purchaseToken,
      params.notificationType,
      eventTime,
      JSON.stringify(params.payload),
    ]
  );
}

async function updateSubscriptionFromWebhook(
  input: UpdateSubscriptionFromWebhookInput
): Promise<void> {
  const status = mapGoogleStateToDbStatus(
    input.verifyResult.raw,
    input.verifyResult.valid
  );

  const startsAt = toDateOrNull(input.verifyResult.purchaseDateMs);
  const endsAt = toDateOrNull(input.verifyResult.expiresAtMs);

  const mergedPayload = {
    source: 'google_rtdn',
    notificationType: input.notificationType,
    eventTimeMillis: input.eventTimeMillis,
    processedAt: new Date().toISOString(),
    verifyResult: input.verifyResult,
  };

  const updateResult = await db.query(
    `
    UPDATE club_subscriptions
       SET product_id = $1,
           order_id = COALESCE($2, order_id),
           status = $3,
           starts_at = COALESCE($4, starts_at),
           ends_at = COALESCE($5, ends_at),
           verification_payload = $6::jsonb,
           updated_at = NOW()
     WHERE id = (
       SELECT id
         FROM club_subscriptions
        WHERE platform = 'android'
          AND purchase_token = $7
        ORDER BY updated_at DESC
        LIMIT 1
     )
    `,
    [
      input.productId,
      input.verifyResult.orderId ?? null,
      status,
      startsAt,
      endsAt,
      JSON.stringify(mergedPayload),
      input.purchaseToken,
    ]
  );

  if (updateResult.rowCount === 0) {
    logger.warn(
      '[google-rtdn] no club_subscriptions row found for purchase token',
      {
        purchaseToken: input.purchaseToken,
        productId: input.productId,
        orderId: input.verifyResult.orderId ?? null,
        status,
      }
    );
    void recordSystemEvent({
      category: 'webhook',
      event_type: 'webhook_no_local_subscription',
      event_status: 'info',
      platform: 'android',
      product_id: input.productId,
      purchase_token: input.purchaseToken,
      message: 'no club_subscriptions row found for purchase_token',
      details: { orderId: input.verifyResult.orderId ?? null, status },
    });
    return;
  }

  logger.info('[google-rtdn] club_subscriptions updated from webhook', {
    purchaseToken: input.purchaseToken,
    productId: input.productId,
    orderId: input.verifyResult.orderId ?? null,
    status,
  });

  await db.query(
    `
    UPDATE clubs
       SET pro_status = CASE
             WHEN EXISTS (
               SELECT 1
                 FROM club_subscriptions cs
                WHERE cs.club_id = clubs.id
                  AND cs.status = 'active'
                  AND cs.ends_at > NOW()
             )
             THEN 'pro'
             ELSE 'free'
           END,
           pro_expires_at = (
             SELECT MAX(cs.ends_at)
               FROM club_subscriptions cs
              WHERE cs.club_id = clubs.id
                AND cs.status = 'active'
                AND cs.ends_at > NOW()
           ),
           pro_updated_at = NOW()
     WHERE id = (
       SELECT club_id
         FROM club_subscriptions
        WHERE platform = 'android'
          AND purchase_token = $1
        ORDER BY updated_at DESC
        LIMIT 1
     )
    `,
    [input.purchaseToken]
  );
}

export async function processGoogleRtdnEnvelope(
  envelope: PubSubPushEnvelope
): Promise<void> {
  const message = envelope.message;
  if (!message?.data) {
    throw new Error('Pub/Sub message.data is missing');
  }

  const messageId = message.messageId ?? '';
  if (messageId && wasMessageProcessed(messageId)) {
    // Duplicate — already processed in this process instance. Log only, no DB write.
    logger.info('[google-rtdn] duplicate message ignored', { messageId });
    return;
  }

  const payload = decodePubSubMessage(message.data);

  const rtdnType = classifyRtdnPayload(payload);
  const unknownKeys = safePayloadTopLevelKeys(payload);

  logger.info('[google-rtdn] notification received', {
    messageId,
    packageName: payload.packageName ?? null,
    eventTimeMillis: payload.eventTimeMillis ?? null,
    rtdnType,
    hasSubscriptionNotification: !!payload.subscriptionNotification,
    hasTestNotification: !!payload.testNotification,
    hasOneTimeProductNotification: !!payload.oneTimeProductNotification,
    hasVoidedPurchaseNotification: !!payload.voidedPurchaseNotification,
    unknownTopLevelKeys: unknownKeys.length > 0 ? unknownKeys : undefined,
  });
  // webhook_received is not written to system_events — it fires for every
  // message including test/retry traffic and adds noise without signal.
  // The logger.info above is sufficient for operational visibility.

  // Persist every incoming event first, even test or malformed ones.
  // sub may be undefined here for non-subscription notification types.
  await insertWebhookEvent({
    messageId: messageId || null,
    payload,
    productId: payload.subscriptionNotification?.subscriptionId ?? null,
    purchaseToken: payload.subscriptionNotification?.purchaseToken ?? null,
    notificationType:
      payload.subscriptionNotification?.notificationType ?? null,
  });

  // ── Route by notification type ────────────────────────────────────────────

  if (rtdnType === 'test') {
    logger.info('[google-rtdn] test notification received', { messageId });
    if (messageId) markMessageProcessed(messageId);
    return;
  }

  if (rtdnType === 'one_time_product') {
    // Google sends these for one-time IAP purchases. We don't process them,
    // but they are expected and should NOT produce webhook_failed rows.
    logger.info(
      '[google-rtdn] one_time_product notification ignored (not supported)',
      {
        messageId,
        packageName: payload.packageName ?? null,
        sku: payload.oneTimeProductNotification?.sku ?? null,
        notificationType:
          payload.oneTimeProductNotification?.notificationType ?? null,
      }
    );
    if (messageId) markMessageProcessed(messageId);
    return;
  }

  if (rtdnType === 'voided_purchase') {
    // Google sends these when a purchase is voided/refunded. We don't process them.
    logger.info(
      '[google-rtdn] voided_purchase notification ignored (not supported)',
      {
        messageId,
        packageName: payload.packageName ?? null,
        productType: payload.voidedPurchaseNotification?.productType ?? null,
      }
    );
    if (messageId) markMessageProcessed(messageId);
    return;
  }

  if (rtdnType === 'unknown') {
    // Future Google RTDN type we don't recognise yet. Ack it (return 200 from
    // the controller) but log with enough context to diagnose.
    logger.warn('[google-rtdn] unknown notification type ignored', {
      messageId,
      packageName: payload.packageName ?? null,
      unknownTopLevelKeys: unknownKeys,
    });
    if (messageId) markMessageProcessed(messageId);
    return;
  }

  // ── subscriptionNotification path ────────────────────────────────────────
  // At this point rtdnType === 'subscription', so sub is always defined.
  const sub = payload.subscriptionNotification!;

  const expectedPackageName = requireEnv('GOOGLE_PLAY_PACKAGE_NAME');
  if (payload.packageName && payload.packageName !== expectedPackageName) {
    throw new Error(
      `Package name mismatch: expected ${expectedPackageName}, got ${payload.packageName}`
    );
  }

  const purchaseToken = sub.purchaseToken?.trim();
  const productId = sub.subscriptionId?.trim();

  if (!purchaseToken) {
    throw new Error('Missing RTDN purchaseToken');
  }

  if (!productId) {
    throw new Error('Missing RTDN subscriptionId');
  }

  const verifyResult = await verifyGooglePurchase({
    productId,
    purchaseToken,
  });

  await updateSubscriptionFromWebhook({
    productId,
    purchaseToken,
    notificationType: sub.notificationType ?? null,
    eventTimeMillis: payload.eventTimeMillis ?? null,
    verifyResult,
  });

  if (messageId) {
    markMessageProcessed(messageId);
  }

  void recordSystemEvent({
    category: 'webhook',
    event_type: 'webhook_processed',
    event_status: 'success',
    platform: 'android',
    product_id: productId,
    purchase_token: purchaseToken,
    message: messageId || null,
    details: { notificationType: sub.notificationType ?? null },
  });
}
