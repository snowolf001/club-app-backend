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
  [key: string]: unknown;
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
      event_status: 'failure',
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
    logger.info('[google-rtdn] duplicate message ignored', { messageId });
    void recordSystemEvent({
      category: 'webhook',
      event_type: 'webhook_duplicate_ignored',
      event_status: 'info',
      platform: 'android',
      message: messageId,
    });
    return;
  }

  const payload = decodePubSubMessage(message.data);

  logger.info('[google-rtdn] notification received', {
    messageId,
    packageName: payload.packageName,
    eventTimeMillis: payload.eventTimeMillis,
    hasSubscriptionNotification: !!payload.subscriptionNotification,
    hasTestNotification: !!payload.testNotification,
  });

  void recordSystemEvent({
    category: 'webhook',
    event_type: 'webhook_received',
    event_status: 'info',
    platform: 'android',
    product_id: payload.subscriptionNotification?.subscriptionId ?? null,
    purchase_token: payload.subscriptionNotification?.purchaseToken ?? null,
    message: messageId || null,
    details: {
      packageName: payload.packageName ?? null,
      hasSubscriptionNotification: !!payload.subscriptionNotification,
      hasTestNotification: !!payload.testNotification,
    },
  });

  const sub = payload.subscriptionNotification;

  // Persist every incoming event first, even test or malformed ones.
  await insertWebhookEvent({
    messageId: messageId || null,
    payload,
    productId: sub?.subscriptionId ?? null,
    purchaseToken: sub?.purchaseToken ?? null,
    notificationType: sub?.notificationType ?? null,
  });

  if (payload.testNotification) {
    logger.info('[google-rtdn] test notification received', { messageId });
    if (messageId) {
      markMessageProcessed(messageId);
    }
    return;
  }

  if (!sub) {
    logger.warn('[google-rtdn] non-subscription notification ignored', {
      messageId,
      payload,
    });
    if (messageId) {
      markMessageProcessed(messageId);
    }
    return;
  }

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
