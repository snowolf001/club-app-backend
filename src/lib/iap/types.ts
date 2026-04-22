/**
 * Shared IAP verification result type.
 * Both Apple and Google verifiers return this unified shape so the
 * subscription service can handle both platforms the same way.
 */
export interface IapVerifyResult {
  valid: boolean;

  /** SKU / product id */
  productId: string;

  /** iOS: unique per individual payment */
  transactionId?: string;

  /** iOS: shared across renewals — used for restore */
  originalTransactionId?: string;

  /** Android: unique purchase token */
  purchaseToken?: string;

  /** Android: order identifier */
  orderId?: string;

  /** Subscription purchase time (ms) */
  purchaseDateMs?: number;

  /** Subscription expiration time (ms) — CRITICAL */
  expiresAtMs?: number;

  /** iOS: whether auto-renew is currently enabled */
  autoRenewEnabled?: boolean;

  /** Raw provider response for storage / debugging */
  raw?: unknown;

  /** Human-readable error when valid === false */
  errorMessage?: string;
}
