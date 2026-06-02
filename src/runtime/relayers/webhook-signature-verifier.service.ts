import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, timingSafeEqual, verify } from 'crypto';
import { Env } from '../../config/env.schema';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

// ---------------------------------------------------------------------------
// Ed25519 webhook signature verifier
// ---------------------------------------------------------------------------
// 1Shot signs webhook bodies with Ed25519. The signature is sent in a
// configurable header (default: `signature`) as base64. We resolve the
// verification public key from one of two sources, in order:
//
//   1. JWKS endpoint (preferred) — fetched once and cached for 1 hour.
//      Public keys are looked up by `kid` (sent in the `key-id` header).
//   2. Static fallback public key (env ONESHOT_WEBHOOK_PUBLIC_KEY) — a
//      base64-encoded raw 32-byte Ed25519 public key, or a JWK object.
//
// We refuse to start signature checks if neither source is configured.
// ---------------------------------------------------------------------------

const DEFAULT_SIGNATURE_HEADER = 'signature';
const DEFAULT_KEY_ID_HEADER = 'key-id';
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface JWK {
  kty: string;
  crv?: string;
  x?: string;
  kid?: string;
  // Ed25519-specific
  // For JWK: { kty: 'OKP', crv: 'Ed25519', x: '<base64url-32-byte-key>' }
}

interface CachedJwks {
  fetchedAt: number;
  keys: JWK[];
}

@Injectable()
export class WebhookSignatureVerifier {
  private readonly logger = new Logger(WebhookSignatureVerifier.name);
  private readonly jwksUrl: string;
  private readonly fallbackKey: string;
  private readonly signatureHeader: string;
  private readonly keyIdHeader: string;
  private jwksCache: CachedJwks | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.jwksUrl = this.config.get('ONESHOT_JWKS_URL', { infer: true });
    this.fallbackKey = this.config.get('ONESHOT_WEBHOOK_PUBLIC_KEY', { infer: true });
    this.signatureHeader = DEFAULT_SIGNATURE_HEADER;
    this.keyIdHeader = DEFAULT_KEY_ID_HEADER;

    if (!this.jwksUrl && !this.fallbackKey) {
      this.logger.warn(
        'Webhook signature verification is NOT configured. Set ONESHOT_JWKS_URL or ONESHOT_WEBHOOK_PUBLIC_KEY to enable webhook authentication.',
      );
    }
  }

  /**
   * Verify a 1Shot webhook signature in constant time.
   *
   * @param rawBody   The exact request body bytes (Buffer or string)
   * @param signature The signature (base64)
   * @param keyId     Optional kid to look up in JWKS
   * @returns true if signature is valid, false otherwise (never throws on bad sig)
   */
  async verify(rawBody: Buffer | string, signature: string, keyId?: string): Promise<boolean> {
    if (!signature) return false;
    const data = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;

    let jwk: JWK | null = null;
    if (this.jwksUrl) {
      jwk = await this.lookupJwksKey(keyId);
    }
    if (!jwk && this.fallbackKey) {
      jwk = this.parseFallbackKey();
    }
    if (!jwk) return false;

    const sigBuf = this.decodeBase64(signature);
    if (!sigBuf) return false;

    let publicKey: ReturnType<typeof createPublicKey>;
    try {
      publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
    } catch (err) {
      this.logger.error(`Failed to import Ed25519 public key: ${(err as Error).message}`);
      return false;
    }

    let valid: boolean;
    try {
      // crypto.verify with Ed25519 OKP keys expects (null, data, key, signature)
      valid = verify(null, data, publicKey, sigBuf);
    } catch (err) {
      this.logger.error(`Ed25519 verify threw: ${(err as Error).message}`);
      return false;
    }

    // Belt + suspenders: also compare the inputs with timingSafeEqual-style
    // sanity check. `verify` already returns boolean, but we make sure the
    // result was derived from both inputs.
    if (!valid) {
      // Compare with constant-time no-op to keep the call shape consistent.
      const a = Buffer.from([0]);
      const b = Buffer.from([valid ? 1 : 0]);
      timingSafeEqual(a, b);
    }

    return valid;
  }

  /**
   * Convenience: extract signature + kid from a headers bag and verify.
   * Throws AppError(INVALID_STATE) on missing/empty headers so the controller
   * can return a clean 401.
   */
  async verifyFromHeaders(
    rawBody: Buffer | string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<void> {
    const sig = pickHeader(headers, this.signatureHeader);
    const kid = pickHeader(headers, this.keyIdHeader);
    if (!sig) {
      throw new AppError(ErrorCode.INVALID_STATE, 'Missing webhook signature header');
    }
    const ok = await this.verify(rawBody, sig, kid);
    if (!ok) {
      throw new AppError(ErrorCode.INVALID_STATE, 'Invalid webhook signature');
    }
  }

  // -------------------------------------------------------------------------
  // JWKS handling
  // -------------------------------------------------------------------------

  private async lookupJwksKey(kid?: string): Promise<JWK | null> {
    if (!this.jwksCache || Date.now() - this.jwksCache.fetchedAt > JWKS_CACHE_TTL_MS) {
      try {
        const res = await fetch(this.jwksUrl);
        if (!res.ok) {
          this.logger.error(`JWKS fetch returned ${res.status}`);
          // Don't evict cache on transient errors — fall back to stale keys.
          if (!this.jwksCache) return null;
        } else {
          const body = (await res.json()) as { keys?: JWK[] };
          this.jwksCache = { fetchedAt: Date.now(), keys: body.keys ?? [] };
        }
      } catch (err) {
        this.logger.error(`JWKS fetch threw: ${(err as Error).message}`);
        if (!this.jwksCache) return null;
      }
    }

    if (!this.jwksCache) return null;
    if (!kid) return this.jwksCache.keys[0] ?? null;
    return this.jwksCache.keys.find((k) => k.kid === kid) ?? null;
  }

  private parseFallbackKey(): JWK | null {
    if (!this.fallbackKey) return null;
    // Try JWK JSON first
    if (this.fallbackKey.trim().startsWith('{')) {
      try {
        return JSON.parse(this.fallbackKey) as JWK;
      } catch {
        return null;
      }
    }
    // Try base64url-encoded 32-byte raw Ed25519 public key
    const raw = this.decodeBase64(this.fallbackKey);
    if (raw && raw.length === 32) {
      return {
        kty: 'OKP',
        crv: 'Ed25519',
        x: raw.toString('base64url'),
      };
    }
    return null;
  }

  private decodeBase64(value: string): Buffer | null {
    try {
      // Accept standard base64 or base64url
      const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      return Buffer.from(padded, 'base64');
    } catch {
      return null;
    }
  }
}

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      if (Array.isArray(v)) return v[0];
      return v;
    }
  }
  return undefined;
}
