/**
 * Slug generation + validation.
 *
 * Slugs are the UI-facing handle embedded in `/pay/:slug`. They must
 * be:
 *
 *   - Short — fits a URL without wrapping. 10-14 chars is the
 *     sweet spot.
 *   - URL-safe — no slashes, no padding. We use Crockford base32
 *     (0-9, A-Z minus I, L, O, U) for legibility and case
 *     insensitivity.
 *   - Collision-resistant — 10 chars of base32 gives 50 bits of
 *     entropy. At 1M invoices per merchant the birthday-collision
 *     probability is ~10^-4. We still check collisions at `put()`
 *     time and re-roll if necessary.
 *
 * We intentionally do NOT use UUIDs — they're 36 chars, case
 * sensitive with hyphens, and noisy in URLs. Crockford base32 is
 * the standard answer for "short, shareable identifiers."
 *
 * Slugs are NOT signed. The canonical cryptographic identifier for
 * an invoice is `id = keccak256(...)`. The slug is just the routing
 * handle; collisions are operator bugs, not cryptographic failures.
 */

import { InvoiceError } from "./errors";

/**
 * Crockford base32 alphabet — excludes I, L, O, U to avoid
 * confusion with 1, 1, 0, and common obscenity.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" as const;
const ALPHABET_SET = new Set(ALPHABET);

/** Default slug length — 10 chars = 50 bits of entropy. */
export const DEFAULT_SLUG_LENGTH = 10 as const;

/** Longer slugs for very high-throughput merchants. */
export const LONG_SLUG_LENGTH = 14 as const;

/**
 * Generate a fresh random slug. Uses `crypto.getRandomValues` for
 * uniform entropy.
 */
export function generateSlug(length: number = DEFAULT_SLUG_LENGTH): string {
  if (length < 6 || length > 32) {
    throw new InvoiceError("slug-invalid", `slug length ${length} out of range [6, 32]`);
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // Map each byte to a base32 char by taking its low 5 bits. This
  // introduces negligible bias — 5 bits from a uniform byte is
  // itself uniform.
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] & 0x1f];
  }
  return out;
}

/**
 * Validate a slug's shape (length + alphabet). Does NOT check
 * whether it resolves to a stored invoice — that's the store's job.
 *
 * Normalises to upper-case because Crockford base32 is case-
 * insensitive; the store should persist slugs uppercase so lookups
 * are deterministic.
 */
export function normalizeSlug(slug: string): string {
  const upper = slug.toUpperCase();
  if (upper.length < 6 || upper.length > 32) {
    throw new InvoiceError(
      "slug-invalid",
      `slug length ${upper.length} out of range [6, 32]`,
    );
  }
  for (const ch of upper) {
    if (!ALPHABET_SET.has(ch)) {
      throw new InvoiceError(
        "slug-invalid",
        `slug contains invalid char "${ch}" — Crockford base32 only`,
      );
    }
  }
  return upper;
}

/** Predicate form. Returns `false` instead of throwing. */
export function isValidSlug(slug: string): boolean {
  try {
    normalizeSlug(slug);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a slug that doesn't collide with any existing slug in
 * the provided set. Retries up to `maxAttempts` times before
 * giving up. Typical caller pattern:
 *
 *     const slug = await generateUniqueSlug(async (candidate) =>
 *       (await store.getBySlug(candidate)) !== null,
 *     );
 *
 * Exported as an async helper (rather than forcing callers to
 * implement the loop themselves) because collision-checking is
 * async against any real store.
 */
export async function generateUniqueSlug(
  isTaken: (candidate: string) => Promise<boolean>,
  opts: { readonly length?: number; readonly maxAttempts?: number } = {},
): Promise<string> {
  const length = opts.length ?? DEFAULT_SLUG_LENGTH;
  const max = opts.maxAttempts ?? 8;
  for (let i = 0; i < max; i += 1) {
    const candidate = generateSlug(length);
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new InvoiceError(
    "slug-collision",
    `failed to find a free slug after ${max} attempts — store may be over-provisioned or length too short`,
  );
}
