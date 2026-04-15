/**
 * Apple App Store purchase verification.
 *
 * Current implementation:
 * - Transitional server-side receipt validation using verifyReceipt
 * - Production-first, fallback to Sandbox on status 21007
 * - Extracts the latest matching subscription transaction for the given product
 *
 * Important:
 * - Apple has deprecated verifyReceipt.
 * - Preferred long-term production direction is App Store Server API
 *   + signed transaction / subscription status workflows.
 *
 * Required env vars:
 *   APPLE_SHARED_SECRET
 *
 * Notes:
 * - Keep IAP_MOCK_ENABLED=true only for local/closed-testing.
 * - Do not enable IAP_MOCK_ENABLED in production.
 */

import { IapVerifyResult } from './types';

export interface AppleVerifyInput {
  productId: string;
  receiptData: string;
  transactionId?: string;
  originalTransactionId?: string;
}

interface AppleVerifyReceiptItem {
  product_id?: string;
  transaction_id?: string;
  original_transaction_id?: string;
  purchase_date_ms?: string;
  expires_date_ms?: string;
  cancellation_date_ms?: string;
}

interface AppleVerifyReceiptResponse {
  status: number;
  environment?: 'Production' | 'Sandbox' | string;
  latest_receipt_info?: AppleVerifyReceiptItem[];
  receipt?: {
    in_app?: AppleVerifyReceiptItem[];
  };
  latest_receipt?: string;
  pending_renewal_info?: unknown[];
  [key: string]: unknown;
}

const APPLE_PRODUCTION_VERIFY_URL =
  'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_VERIFY_URL =
  'https://sandbox.itunes.apple.com/verifyReceipt';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Apple IAP verification`);
  }
  return value;
}

function toMs(value?: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickLatestValidItem(
  items: AppleVerifyReceiptItem[],
  input: AppleVerifyInput
): AppleVerifyReceiptItem | null {
  const candidates = items.filter((item) => {
    if (item.product_id !== input.productId) return false;

    // 优先精确匹配 transactionId
    if (input.transactionId && item.transaction_id === input.transactionId) {
      return true;
    }

    // 其次匹配 originalTransactionId
    if (
      input.originalTransactionId &&
      item.original_transaction_id === input.originalTransactionId
    ) {
      return true;
    }

    // 如果前端没传 id，就接受同 product 的记录
    if (!input.transactionId && !input.originalTransactionId) {
      return true;
    }

    return false;
  });

  if (candidates.length === 0) {
    return null;
  }

  // 取 expires_date_ms 最大的一条；没有 expires_date_ms 时退回 purchase_date_ms
  candidates.sort((a, b) => {
    const aExpires = toMs(a.expires_date_ms) ?? 0;
    const bExpires = toMs(b.expires_date_ms) ?? 0;
    if (bExpires !== aExpires) return bExpires - aExpires;

    const aPurchase = toMs(a.purchase_date_ms) ?? 0;
    const bPurchase = toMs(b.purchase_date_ms) ?? 0;
    return bPurchase - aPurchase;
  });

  return candidates[0] ?? null;
}

async function postVerifyReceipt(
  url: string,
  receiptData: string,
  sharedSecret: string
): Promise<AppleVerifyReceiptResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      'receipt-data': receiptData,
      password: sharedSecret,
      'exclude-old-transactions': false,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Apple verifyReceipt HTTP ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as AppleVerifyReceiptResponse;
  return data;
}

export async function verifyApplePurchase(
  input: AppleVerifyInput
): Promise<IapVerifyResult> {
  if (process.env.IAP_MOCK_ENABLED === 'true') {
    const mockTx = input.transactionId ?? `mock_tx_${Date.now()}`;
    const mockOrig = input.originalTransactionId ?? `mock_orig_${Date.now()}`;

    return {
      valid: true,
      productId: input.productId,
      transactionId: mockTx,
      originalTransactionId: mockOrig,
      raw: {
        mock: true,
        productId: input.productId,
      },
    };
  }

  try {
    if (!input.receiptData || !input.receiptData.trim()) {
      return {
        valid: false,
        productId: input.productId,
        errorMessage: 'Missing Apple receiptData',
      };
    }

    const sharedSecret = requireEnv('APPLE_SHARED_SECRET');

    // 先打生产；若收到 21007，再切到 sandbox
    let verifyResponse = await postVerifyReceipt(
      APPLE_PRODUCTION_VERIFY_URL,
      input.receiptData,
      sharedSecret
    );

    if (verifyResponse.status === 21007) {
      verifyResponse = await postVerifyReceipt(
        APPLE_SANDBOX_VERIFY_URL,
        input.receiptData,
        sharedSecret
      );
    }

    if (verifyResponse.status !== 0) {
      return {
        valid: false,
        productId: input.productId,
        errorMessage: `Apple receipt validation failed with status ${verifyResponse.status}`,
        raw: verifyResponse,
      };
    }

    const items = [
      ...(verifyResponse.latest_receipt_info ?? []),
      ...(verifyResponse.receipt?.in_app ?? []),
    ];

    if (items.length === 0) {
      return {
        valid: false,
        productId: input.productId,
        errorMessage: 'Apple receipt validation returned no transactions',
        raw: verifyResponse,
      };
    }

    const matched = pickLatestValidItem(items, input);

    if (!matched) {
      return {
        valid: false,
        productId: input.productId,
        errorMessage:
          'No matching Apple subscription transaction found for this product',
        raw: verifyResponse,
      };
    }

    if (matched.cancellation_date_ms) {
      return {
        valid: false,
        productId: input.productId,
        transactionId: matched.transaction_id,
        originalTransactionId: matched.original_transaction_id,
        errorMessage: 'Apple subscription transaction was cancelled/revoked',
        raw: verifyResponse,
      };
    }

    return {
      valid: true,
      productId: matched.product_id ?? input.productId,
      transactionId: matched.transaction_id,
      originalTransactionId: matched.original_transaction_id,
      purchaseDateMs: toMs(matched.purchase_date_ms) ?? undefined,
      expiresAtMs: toMs(matched.expires_date_ms) ?? undefined,
      raw: verifyResponse,
    };
  } catch (error) {
    return {
      valid: false,
      productId: input.productId,
      errorMessage:
        error instanceof Error ? error.message : 'Unknown Apple verify error',
    };
  }
}
