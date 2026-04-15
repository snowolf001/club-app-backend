/**
 * Google Play subscription purchase verification.
 *
 * Production implementation:
 * - Uses Google Play Developer API purchases.subscriptionsv2.get
 * - Authenticates with a service account
 * - Verifies ACTIVE subscription state
 * - Auto-acknowledges the purchase if needed
 * - Returns raw provider payload for audit/debug storage
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_KEY
 *   GOOGLE_PLAY_PACKAGE_NAME
 *
 * Notes:
 * - Keep IAP_MOCK_ENABLED=true only for local/closed-testing if you explicitly want mock mode.
 * - Do not enable IAP_MOCK_ENABLED in production.
 */

import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { IapVerifyResult } from './types';

export interface GoogleVerifyInput {
  productId: string;
  purchaseToken: string;
  orderId?: string;
}

interface GoogleServiceAccountJson {
  client_email: string;
  private_key: string;
  [key: string]: unknown;
}

interface GoogleSubscriptionLineItem {
  productId?: string;
  expiryTime?: string; // RFC 3339 timestamp
  autoRenewingPlan?: Record<string, unknown>;
  prepaidPlan?: Record<string, unknown>;
  offerDetails?: Record<string, unknown>;
}

interface GoogleSubscriptionPurchaseV2 {
  kind?: string;
  regionCode?: string;
  startTime?: string; // RFC 3339
  subscriptionState?: string;
  latestOrderId?: string;
  acknowledgementState?: string;
  lineItems?: GoogleSubscriptionLineItem[];
  canceledStateContext?: unknown;
  pausedStateContext?: unknown;
  testPurchase?: unknown;
  externalAccountIdentifiers?: unknown;
  subscribeWithGoogleInfo?: unknown;
  [key: string]: unknown;
}

const GOOGLE_ANDROID_PUBLISHER_SCOPE =
  'https://www.googleapis.com/auth/androidpublisher';

// Simple in-memory token cache for this process
let cachedAccessToken: string | null = null;
let cachedAccessTokenExpiresAt = 0;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Google IAP verification`);
  }
  return value;
}

function parseGoogleServiceAccountKey(raw: string): GoogleServiceAccountJson {
  // 1) raw JSON content
  if (raw.trim().startsWith('{')) {
    return JSON.parse(raw) as GoogleServiceAccountJson;
  }

  // 2) filesystem path
  const fileContent = fs.readFileSync(raw, 'utf8');
  return JSON.parse(fileContent) as GoogleServiceAccountJson;
}

function toMsFromRfc3339(value?: string): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function pickBestLineItem(
  lineItems: GoogleSubscriptionLineItem[] | undefined,
  productId: string
): GoogleSubscriptionLineItem | undefined {
  if (!lineItems || lineItems.length === 0) {
    return undefined;
  }

  const exactMatches = lineItems.filter((item) => item.productId === productId);
  const pool = exactMatches.length > 0 ? exactMatches : lineItems;

  const sorted = [...pool].sort((a, b) => {
    const aExpiry = toMsFromRfc3339(a.expiryTime) ?? 0;
    const bExpiry = toMsFromRfc3339(b.expiryTime) ?? 0;
    return bExpiry - aExpiry;
  });

  return sorted[0];
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();

  // Reuse token until shortly before expiry
  if (
    cachedAccessToken &&
    cachedAccessTokenExpiresAt > now + 60_000 // 1 min safety buffer
  ) {
    return cachedAccessToken;
  }

  const rawKey = requireEnv('GOOGLE_SERVICE_ACCOUNT_KEY');
  const keyJson = parseGoogleServiceAccountKey(rawKey);

  const auth = new GoogleAuth({
    credentials: keyJson,
    scopes: [GOOGLE_ANDROID_PUBLISHER_SCOPE],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken =
    typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;

  if (!accessToken) {
    throw new Error('Failed to obtain Google access token');
  }

  // google-auth-library does not always expose expiry clearly from getAccessToken(),
  // so cache conservatively for 50 minutes.
  cachedAccessToken = accessToken;
  cachedAccessTokenExpiresAt = now + 50 * 60 * 1000;

  return accessToken;
}

async function fetchSubscriptionPurchaseV2(
  packageName: string,
  purchaseToken: string,
  accessToken: string
): Promise<GoogleSubscriptionPurchaseV2> {
  const url =
    'https://androidpublisher.googleapis.com/androidpublisher/v3/' +
    `applications/${encodeURIComponent(packageName)}/` +
    `purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Google subscriptionsv2.get failed: HTTP ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
    );
  }

  return (await response.json()) as GoogleSubscriptionPurchaseV2;
}

async function acknowledgeSubscription(
  packageName: string,
  subscriptionId: string,
  purchaseToken: string,
  accessToken: string
): Promise<void> {
  const url =
    'https://androidpublisher.googleapis.com/androidpublisher/v3/' +
    `applications/${encodeURIComponent(packageName)}/` +
    `purchases/subscriptions/${encodeURIComponent(subscriptionId)}/` +
    `tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Google subscriptions.acknowledge failed: HTTP ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
    );
  }
}

export async function verifyGooglePurchase(
  input: GoogleVerifyInput
): Promise<IapVerifyResult> {
  if (process.env.IAP_MOCK_ENABLED === 'true') {
    const mockOrder = input.orderId ?? `mock_order_${Date.now()}`;
    const now = Date.now();

    return {
      valid: true,
      productId: input.productId,
      purchaseToken: input.purchaseToken,
      orderId: mockOrder,
      purchaseDateMs: now,
      expiresAtMs: now + 30 * 24 * 60 * 60 * 1000,
      raw: { mock: true, productId: input.productId },
    };
  }

  try {
    if (!input.purchaseToken || !input.purchaseToken.trim()) {
      return {
        valid: false,
        productId: input.productId,
        errorMessage: 'Missing Google purchaseToken',
      };
    }

    if (!input.productId || !input.productId.trim()) {
      return {
        valid: false,
        productId: input.productId,
        purchaseToken: input.purchaseToken,
        errorMessage: 'Missing Google productId',
      };
    }

    const packageName = requireEnv('GOOGLE_PLAY_PACKAGE_NAME');
    const accessToken = await getAccessToken();

    let purchase = await fetchSubscriptionPurchaseV2(
      packageName,
      input.purchaseToken,
      accessToken
    );

    const lineItem = pickBestLineItem(purchase.lineItems, input.productId);

    if (!lineItem) {
      return {
        valid: false,
        productId: input.productId,
        purchaseToken: input.purchaseToken,
        orderId: purchase.latestOrderId ?? input.orderId,
        errorMessage:
          'No matching Google subscription line item found for this product',
        raw: purchase,
      };
    }

    if (!lineItem.productId || lineItem.productId !== input.productId) {
      return {
        valid: false,
        productId: input.productId,
        purchaseToken: input.purchaseToken,
        orderId: purchase.latestOrderId ?? input.orderId,
        errorMessage: `Google productId mismatch: expected ${input.productId}, got ${lineItem.productId ?? 'UNKNOWN'}`,
        raw: purchase,
      };
    }

    const expiresAtMs = toMsFromRfc3339(lineItem.expiryTime);
    const purchaseDateMs = toMsFromRfc3339(purchase.startTime);
    const isTestPurchase = !!purchase.testPurchase;

    if (!expiresAtMs) {
      return {
        valid: false,
        productId: input.productId,
        purchaseToken: input.purchaseToken,
        orderId: purchase.latestOrderId ?? input.orderId,
        errorMessage: 'Google subscription response did not include expiryTime',
        raw: {
          ...purchase,
          isTestPurchase,
        },
      };
    }

    // Conservative rule:
    // only accept ACTIVE subscriptions as valid for granting Pro immediately.
    if (purchase.subscriptionState !== 'SUBSCRIPTION_STATE_ACTIVE') {
      return {
        valid: false,
        productId: input.productId,
        purchaseToken: input.purchaseToken,
        orderId: purchase.latestOrderId ?? input.orderId,
        purchaseDateMs,
        expiresAtMs,
        errorMessage: `Google subscription is not active: ${purchase.subscriptionState ?? 'UNKNOWN'}`,
        raw: {
          ...purchase,
          isTestPurchase,
        },
      };
    }

    // Try to acknowledge if needed before granting entitlement.
    if (
      purchase.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
    ) {
      await acknowledgeSubscription(
        packageName,
        input.productId,
        input.purchaseToken,
        accessToken
      );

      // Re-fetch after acknowledge so the stored raw payload reflects latest state.
      purchase = await fetchSubscriptionPurchaseV2(
        packageName,
        input.purchaseToken,
        accessToken
      );
    }

    if (
      purchase.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
    ) {
      return {
        valid: false,
        productId: input.productId,
        purchaseToken: input.purchaseToken,
        orderId: purchase.latestOrderId ?? input.orderId,
        purchaseDateMs,
        expiresAtMs,
        errorMessage: `Google subscription is not acknowledged: ${purchase.acknowledgementState ?? 'UNKNOWN'}`,
        raw: {
          ...purchase,
          isTestPurchase,
        },
      };
    }

    return {
      valid: true,
      productId: input.productId,
      purchaseToken: input.purchaseToken,
      orderId: purchase.latestOrderId ?? input.orderId,
      purchaseDateMs,
      expiresAtMs,
      raw: {
        ...purchase,
        isTestPurchase,
      },
    };
  } catch (error) {
    return {
      valid: false,
      productId: input.productId,
      purchaseToken: input.purchaseToken,
      orderId: input.orderId,
      errorMessage:
        error instanceof Error ? error.message : 'Unknown Google verify error',
    };
  }
}
