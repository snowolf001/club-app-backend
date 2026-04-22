/**
 * Apple App Store Server Notification JWT verification.
 *
 * Verifies the cryptographic signature and x5c certificate chain of signed JWTs
 * issued by Apple for App Store Server Notifications v2. The same logic also
 * applies to signedTransactionInfo and signedRenewalInfo inner JWTs.
 *
 * Verification steps:
 *   1. Validate JWT structure (3 parts).
 *   2. Parse header: require alg=ES256, require x5c with ≥2 certs.
 *   3. Parse each DER certificate from x5c.
 *   4. Check each certificate's validity period.
 *   5. If the chain root is included in x5c, verify its fingerprint matches our
 *      pinned Apple Root CA G3.
 *   6. Verify: intermediate.verify(appleRootPublicKey) — chain of trust.
 *   7. Verify: leaf.verify(intermediatePublicKey) — chain of trust.
 *   8. Verify the JWT signature using the leaf certificate's public key.
 *   9. Return the decoded payload.
 *
 * Reference:
 *   https://developer.apple.com/documentation/appstoreservernotifications/responsebodyv2
 *   RFC 7518 §3.4 — ECDSA signature encoding (R||S compact form)
 *
 * Supported algorithms:
 *   ES256 (ECDSA with P-256, SHA-256) — the only algorithm Apple currently uses
 *
 * Required env vars: (none — Apple Root CA is pinned in source)
 *
 * Design notes:
 *   - No network calls. All verification is offline using the pinned root cert.
 *   - No external npm packages required. Uses Node.js built-in crypto only.
 *   - The pinned certificate is cached after first parse to avoid repeated DER parsing.
 */

import crypto from 'node:crypto';

// ─── Pinned Apple Root CA G3 ─────────────────────────────────────────────────
//
// Apple Root CA - G3 (EC P-384, self-signed)
// Source:      https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
// Validity:    2014-04-30 to 2039-04-30
// SHA-256 FP:  63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:
//              7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79
//
// This certificate is pinned here so we can verify the x5c chain without
// network calls. If Apple rotates their root (extremely unlikely before 2039),
// this constant must be updated.
//
// The Apple App Store Server Notification chain is:
//   [leaf (ES256/P-256)] → [WWDR intermediate (ES256/P-256)] → [Root CA G3 (P-384)]

const APPLE_ROOT_CA_G3_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwS
QXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9u
IEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcN
MTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBS
b290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9y
aXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49
AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtf
TjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517
IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySr
MA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gA
MGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4
at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM
6BgD56KyKA==
-----END CERTIFICATE-----`;

// Only ES256 is used by Apple. Reject anything else.
const SUPPORTED_ALG = 'ES256';

// Lazy-initialised cache — parsed once per process lifetime.
let _cachedAppleRootCert: crypto.X509Certificate | null = null;

function getPinnedAppleRootCert(): crypto.X509Certificate {
  if (!_cachedAppleRootCert) {
    _cachedAppleRootCert = new crypto.X509Certificate(
      Buffer.from(APPLE_ROOT_CA_G3_PEM)
    );
  }
  return _cachedAppleRootCert;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface JwtHeader {
  alg: string;
  // Base64-standard-encoded DER certificates (leaf first, then intermediates, optionally root)
  x5c: string[];
  [key: string]: unknown;
}

function parseAndValidateHeader(headerB64: string): JwtHeader {
  let header: Record<string, unknown>;

  try {
    const json = Buffer.from(headerB64, 'base64url').toString('utf8');
    header = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error('Apple JWT: failed to parse JWT header');
  }

  if (typeof header.alg !== 'string') {
    throw new Error('Apple JWT: header missing alg field');
  }

  if (header.alg !== SUPPORTED_ALG) {
    throw new Error(
      `Apple JWT: unsupported algorithm "${header.alg}". Expected "${SUPPORTED_ALG}"`
    );
  }

  if (
    !Array.isArray(header.x5c) ||
    header.x5c.length < 2 ||
    !(header.x5c as unknown[]).every((c) => typeof c === 'string')
  ) {
    throw new Error(
      'Apple JWT: x5c must be an array of at least 2 base64-encoded DER certificate strings'
    );
  }

  return header as unknown as JwtHeader;
}

/**
 * Verify the x5c certificate chain and return the leaf certificate's public key.
 *
 * Chain layout expected from Apple:
 *   x5c[0] — leaf signing certificate (ES256 / P-256)
 *   x5c[1] — intermediate (Apple WWDR) certificate (ES256 / P-256)
 *   x5c[2] — (optional) root certificate (Apple Root CA G3, EC P-384)
 *
 * Verification:
 *   - Each certificate's validity period includes the current time.
 *   - If a root cert is included in x5c, its fingerprint must match our pinned Apple Root CA G3.
 *   - The intermediate was signed by our pinned Apple Root CA G3.
 *   - The leaf was signed by the intermediate.
 */
function verifyCertChain(x5c: string[]): crypto.KeyObject {
  const pinnedRoot = getPinnedAppleRootCert();
  const now = new Date();

  // Parse at most 3 certs: leaf, intermediate, (optional) root
  const certs = x5c.slice(0, 3).map((b64, idx) => {
    try {
      return new crypto.X509Certificate(Buffer.from(b64, 'base64'));
    } catch (err) {
      throw new Error(
        `Apple JWT: failed to parse x5c[${idx}] certificate: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  });

  // 1. Check validity period for each provided certificate
  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i];
    const notBefore = new Date(cert.validFrom);
    const notAfter = new Date(cert.validTo);

    if (now < notBefore) {
      throw new Error(
        `Apple JWT: x5c[${i}] certificate is not yet valid (validFrom=${cert.validFrom})`
      );
    }

    if (now > notAfter) {
      throw new Error(
        `Apple JWT: x5c[${i}] certificate has expired (validTo=${cert.validTo})`
      );
    }
  }

  const leaf = certs[0];
  const intermediate = certs[1];
  const chainRoot = certs[2];

  // 2. If Apple included the root in x5c, verify its fingerprint against our pinned root
  //    (compare sha-256 fingerprints — format: "AA:BB:CC:..." uppercase hex colon-separated)
  if (chainRoot) {
    if (chainRoot.fingerprint256 !== pinnedRoot.fingerprint256) {
      throw new Error(
        'Apple JWT: x5c root certificate fingerprint does not match the pinned Apple Root CA G3'
      );
    }
  }

  // 3. Verify the intermediate was signed by our pinned Apple Root CA G3
  //    (X509Certificate.verify(pubKey) returns true if this cert's signature was
  //     produced by the private key corresponding to pubKey)
  if (!intermediate.verify(pinnedRoot.publicKey)) {
    throw new Error(
      'Apple JWT: intermediate certificate was not signed by the pinned Apple Root CA G3'
    );
  }

  // 4. Verify the leaf was signed by the intermediate
  if (!leaf.verify(intermediate.publicKey)) {
    throw new Error(
      'Apple JWT: leaf certificate was not signed by the intermediate certificate'
    );
  }

  return leaf.publicKey;
}
// ─── Startup diagnostics ─────────────────────────────────────────────────────

/**
 * Log the expiry date of the pinned Apple Root CA G3.
 *
 * Call once at server startup. If the CA expires within 365 days this logs
 * at WARN level so it surfaces in alerting dashboards. The CA is valid until
 * 2039-04-30; routine log output is INFO. If it has already expired every
 * Apple JWT verification will throw, so this also serves as an early signal.
 */
export function logAppleRootCaExpiry(): void {
  let cert: crypto.X509Certificate;
  try {
    cert = getPinnedAppleRootCert();
  } catch (err) {
    console.error(
      '[apple-ca] CRITICAL: failed to parse pinned Apple Root CA G3 PEM. ' +
        'All Apple JWT verification will fail. Error: ' +
        (err instanceof Error ? err.message : String(err))
    );
    return;
  }
  const expiresAt = new Date(cert.validTo);
  const nowMs = Date.now();
  const daysUntilExpiry = Math.floor(
    (expiresAt.getTime() - nowMs) / (1000 * 60 * 60 * 24)
  );

  if (daysUntilExpiry < 0) {
    // All Apple JWT verification will fail — this should never happen before 2039.
    console.error(
      `[apple-ca] CRITICAL: pinned Apple Root CA G3 has EXPIRED (${cert.validTo}). ` +
        'All Apple JWT verification will fail. Update APPLE_ROOT_CA_G3_PEM in appleJwtVerify.ts immediately.'
    );
  } else if (daysUntilExpiry <= 365) {
    console.warn(
      `[apple-ca] WARNING: pinned Apple Root CA G3 expires in ${daysUntilExpiry} days ` +
        `(${cert.validTo}). Plan to update APPLE_ROOT_CA_G3_PEM in appleJwtVerify.ts.`
    );
  } else {
    console.log(
      `[apple-ca] pinned Apple Root CA G3 valid — expires ${cert.validTo} ` +
        `(${daysUntilExpiry} days from now)`
    );
  }
}
// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify and decode an Apple-signed JWT.
 *
 * Used for:
 *   - The outer `signedPayload` from App Store Server Notifications v2
 *   - The inner `signedTransactionInfo` JWT
 *   - The inner `signedRenewalInfo` JWT
 *
 * All three are signed by Apple using the same ES256 / x5c mechanism.
 *
 * Throws a descriptive Error on any verification failure.
 * Callers must NOT silently catch this error — invalid JWTs must be rejected
 * before any business logic or DB mutation.
 */
export function verifyAndDecodeAppleJwt<T>(jwt: string): T {
  const parts = jwt.split('.');

  if (parts.length !== 3) {
    throw new Error(
      `Apple JWT: invalid structure — expected 3 parts, got ${parts.length}`
    );
  }

  const [headerB64, payloadB64, sigB64] = parts;

  // 1. Parse and validate the JWT header
  const header = parseAndValidateHeader(headerB64);

  // 2. Verify certificate chain; obtain leaf public key
  const leafPublicKey = verifyCertChain(header.x5c);

  // 3. Verify the JWT signature
  //
  //    ES256 = ECDSA with P-256, SHA-256.
  //    JWT compact signature format (RFC 7518 §3.4): raw R||S (32 bytes each = 64 bytes).
  //    Node.js `crypto.verify` with `dsaEncoding: 'ieee-p1363'` accepts this format directly.
  //
  //    The signed data is the exact ASCII bytes of "{headerB64}.{payloadB64}".
  const signingInput = `${headerB64}.${payloadB64}`;
  const rawSignature = Buffer.from(sigB64, 'base64url');

  let isValid: boolean;

  try {
    isValid = crypto.verify(
      'SHA256',
      Buffer.from(signingInput, 'utf8'),
      // dsaEncoding: 'ieee-p1363' = raw R||S (no DER wrapping) — required for JWT
      { key: leafPublicKey, dsaEncoding: 'ieee-p1363' },
      rawSignature
    );
  } catch (err) {
    throw new Error(
      `Apple JWT: signature verification threw an error: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!isValid) {
    throw new Error('Apple JWT: signature verification failed — JWT was not signed by Apple');
  }

  // 4. Decode and return the payload
  let payload: T;

  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    payload = JSON.parse(payloadJson) as T;
  } catch {
    throw new Error('Apple JWT: failed to decode JWT payload');
  }

  return payload;
}
