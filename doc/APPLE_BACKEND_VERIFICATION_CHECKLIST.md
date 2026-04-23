# Apple Backend Verification Checklist

Manual checklist for verifying the iOS subscription backend before production launch.
Run these checks against the **sandbox** environment first, then production.

---

## 0. Prerequisites

- [ ] `APPLE_SHARED_SECRET` is set (App Store Connect → your app → App-Specific Shared Secret)
- [ ] `APPLE_BUNDLE_ID` is set and matches the app's bundle identifier
- [ ] `IAP_MOCK_ENABLED` is **unset** or `false` in the target environment
- [ ] A sandbox Apple ID is available for test purchases
- [ ] The Apple webhook endpoint is registered in App Store Connect (App Information → App Store Server Notifications → Production / Sandbox URL)

---

## 1. Verify endpoint — happy path

**Scenario:** Valid iOS purchase, first-time club with no active subscription.

1. Make a sandbox subscription purchase on the iOS app.
2. Call `POST /api/subscriptions/verify` with:
   ```json
   {
     "clubId": "<valid-club-uuid>",
     "platform": "ios",
     "productId": "passeo_pro_monthly",
     "receiptData": "<base64-receipt>",
     "transactionId": "<from-StoreKit>",
     "originalTransactionId": "<from-StoreKit>"
   }
   ```
3. **Expect:**
   - HTTP 200
   - `data.isPro = true`
   - `data.activeSubscription` is populated with `platform: "ios"`, `status: "active"`
   - `data.billingState = "active_renewing"` (or `"active_cancelled"` if auto-renew was disabled)
   - `data.createdSubscription.id` matches `data.activeSubscription.id`
   - `data.idempotent = false`
4. **DB check:** `SELECT * FROM club_subscriptions WHERE id = '<returned-id>'` — verify `status='active'`, `platform='ios'`, `ends_at` is set.

---

## 2. Verify endpoint — idempotency (same transactionId)

**Scenario:** Client calls verify twice with the same transactionId.

1. Repeat the exact same call from check 1.
2. **Expect:**
   - HTTP 200
   - Same `activeSubscription.id` as before
   - `data.idempotent = true`
3. **DB check:** No second row created. Row count for the club remains 1.

---

## 3. Verify endpoint — restore flow (same originalTransactionId, no new purchase)

**Scenario:** User reinstalls the app and calls verify with the same receipt.

1. Call verify with the same `originalTransactionId` and same or different `transactionId` (same renewal cycle).
2. **Expect:**
   - HTTP 200
   - `data.idempotent = true`
   - Same subscription row returned
3. **DB check:** No duplicate rows.

---

## 4. Verify endpoint — renewal idempotency (new transactionId, same originalTransactionId)

**Scenario:** Apple has auto-renewed the subscription. Client calls verify with the new renewal receipt.

1. After a sandbox renewal occurs, call verify with the NEW `transactionId` but the SAME `originalTransactionId`.
2. **Expect:**
   - HTTP 200
   - `data.idempotent = true`
   - Existing subscription row returned (no new row created)
3. **DB check:** Only 1 row exists for the originalTransactionId with `status NOT IN ('expired')`.

> **Note:** The subscription's `ends_at` will be updated by the webhook (DID_RENEW), not by the verify call. The response may show the pre-renewal expiry date until the webhook fires.

---

## 5. Verify endpoint — second purchase (scheduled subscription)

**Scenario:** Club already has an active subscription. A different club member purchases a second subscription.

1. Club already has active subscription (from check 1).
2. A second member of the same club makes a new purchase with a different `originalTransactionId`.
3. Call verify with the new purchase details.
4. **Expect:**
   - HTTP 200
   - `data.isPro = true`
   - `data.activeSubscription` = the original subscription
   - `data.scheduledSubscription` = the new subscription (`status: "scheduled"`)
   - `data.createdSubscription.status = "scheduled"`
   - `data.idempotent = false`
5. **DB check:** 2 rows for the club — one `active`, one `scheduled`.

---

## 6. Status endpoint

**Scenario:** Check Pro status for a club with an active iOS subscription.

1. Call `GET /api/subscriptions/status?clubId=<club-id>`.
2. **Expect:**
   - `data.isPro = true`
   - `data.billingState = "active_renewing"` (or `"active_cancelled"` if auto-renew is off)
   - `data.activeSubscription` is populated
3. **No special iOS handling needed** — the status endpoint is platform-agnostic.

---

## 7. Status after auto-renew disabled (canceled billing state)

**Scenario:** User turns off auto-renew in iOS Settings. Webhook fires DID_CHANGE_RENEWAL_STATUS + AUTO_RENEW_DISABLED.

1. Send a test DID_CHANGE_RENEWAL_STATUS notification with subtype `AUTO_RENEW_DISABLED` (or use sandbox to trigger it).
2. Call `GET /api/subscriptions/status?clubId=<club-id>`.
3. **Expect:**
   - `data.isPro = true` (subscription still active until ends_at)
   - `data.billingState = "active_cancelled"`
   - `data.activeSubscription.status = "canceled"`
4. **DB check:** Row has `status='canceled'`, `auto_renews=false`.

---

## 8. Apple webhook — JWT verification rejects invalid signatures

**Scenario:** Attacker sends a forged webhook with an invalid or self-signed certificate.

1. POST to `/api/subscriptions/webhooks/apple` with a body containing a self-signed JWT.
2. **Expect:**
   - HTTP 200 (Apple webhook always returns 200 to prevent retries)
   - Response body: `{ "ok": true }`
   - Server logs: `[apple-webhook] processing failed` with a JWT verification error
   - `system_events` table: a `webhook_failed` row is inserted
   - **No DB change to `club_subscriptions`**

---

## 9. Apple webhook — DID_RENEW extends subscription

**Scenario:** Apple auto-renews and sends DID_RENEW notification.

1. Use App Store Connect's sandbox to trigger a renewal, or construct a valid signed DID_RENEW notification.
2. Verify the webhook is called with the signed payload.
3. **Expect:**
   - HTTP 200
   - `club_subscriptions` row for the originalTransactionId has updated `ends_at`
   - `status = 'active'`
   - `verification_payload.notificationType = 'DID_RENEW'`
4. **DB check:**
   - `ends_at` is extended to the new renewal expiry
   - `transaction_id` is NOT changed (stored in `verification_payload.latestTransactionId` for audit)

---

## 10. Apple webhook — EXPIRED marks subscription expired

**Scenario:** Subscription expires (billing failed / user did not renew).

1. Let a sandbox subscription expire, or send a valid EXPIRED notification.
2. **Expect:**
   - `club_subscriptions` row for the originalTransactionId has `status = 'expired'`
   - `clubs` table: `pro_status = 'free'` (if no other active subscription)
3. Call `GET /api/subscriptions/status?clubId=<club-id>`.
4. **Expect:**
   - `data.isPro = false`
   - `data.billingState = "expired"`

---

## 11. Apple webhook — TEST notification is accepted without DB changes

1. Send a TEST notification from App Store Connect.
2. **Expect:**
   - HTTP 200
   - No DB changes
   - Server log: `[apple-webhook] TEST notification received`

---

## 12. Webhook replay protection (duplicate notificationUUID)

**Scenario:** Apple retries a notification (same notificationUUID).

1. Send the same valid webhook payload twice.
2. **Expect:**
   - Both return HTTP 200
   - Server log on second: `[apple-webhook] duplicate notification ignored`
   - Only one `subscription_webhook_events` row for the notificationUUID (ON CONFLICT DO NOTHING)
   - No duplicate DB changes

---

## 13. Sandbox vs. Production environment safety

- [ ] Confirm `APPLE_SHARED_SECRET` is the **production** app-specific shared secret in the production environment.
- [ ] Confirm the webhook URL registered in App Store Connect points to the production backend for production, and the sandbox URL for sandbox.
- [ ] Confirm `IAP_MOCK_ENABLED` is NOT set in production. Check via `env | grep IAP_MOCK`.

---

## Environment variables quick check

```bash
# Run on the server:
echo "APPLE_SHARED_SECRET set: $([ -n "$APPLE_SHARED_SECRET" ] && echo YES || echo MISSING)"
echo "APPLE_BUNDLE_ID: $APPLE_BUNDLE_ID"
echo "IAP_MOCK_ENABLED: ${IAP_MOCK_ENABLED:-<not set>}"
```
