/**
 * Isomorphic provably-fair core, shared by every game and by the browser verifier.
 *
 * One commitment scheme powers the whole casino:
 *   • the server holds a secret `serverSeed` and publishes SHA-256(serverSeed);
 *   • the player owns a public `clientSeed`;
 *   • a per-player `nonce` counts up once per bet, across all games.
 * Each bet's entropy is HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`); each
 * game maps that digest to its own outcome (see games.ts). Rotating the seed
 * reveals the old serverSeed so every past bet can be replayed and verified.
 */

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(message: string): Promise<string> {
  return toHex(await subtle.digest("SHA-256", encoder.encode(message)));
}

export async function hmacSha256Hex(serverSeed: string, message: string): Promise<string> {
  const key = await subtle.importKey(
    "raw",
    encoder.encode(serverSeed),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await subtle.sign("HMAC", key, encoder.encode(message)));
}

/** The per-bet digest every game derives its outcome from. */
export function betMessage(clientSeed: string, nonce: number): string {
  return `${clientSeed}:${nonce}`;
}
export async function betHmac(serverSeed: string, clientSeed: string, nonce: number): Promise<string> {
  return hmacSha256Hex(serverSeed, betMessage(clientSeed, nonce));
}

/** A uniform float in [0, 1) from the first 52 bits of a hex digest. */
export function floatFromHex(hex: string): number {
  return parseInt(hex.slice(0, 13), 16) / 2 ** 52;
}

export const HOUSE_EDGE = 0.01;
