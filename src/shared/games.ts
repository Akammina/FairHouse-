/**
 * Pure per-game outcome math. Each game maps the per-bet HMAC digest to a
 * result deterministically, so the server and the browser verifier compute the
 * identical outcome. All payouts carry the same 1% house edge.
 */
import { floatFromHex, sha256Hex, HOUSE_EDGE } from "./provablyFair.js";

// ---------- Dice: roll under a target ----------
export function diceRoll(hmac: string): number {
  const n = parseInt(hmac.slice(0, 8), 16); // first 32 bits
  return Math.floor((n / 0x100000000) * 10000) / 100; // [0.00, 99.99]
}
export function diceMultiplier(target: number): number {
  return Math.floor(((100 / target) * (1 - HOUSE_EDGE)) * 10000) / 10000;
}
export function diceWin(roll: number, target: number): boolean {
  return roll < target;
}
export const DICE_TARGET_MIN = 2;
export const DICE_TARGET_MAX = 98;

// ---------- Coinflip: heads or tails ----------
export type Coin = "heads" | "tails";
export function coinResult(hmac: string): Coin {
  return floatFromHex(hmac) < 0.5 ? "heads" : "tails";
}
export const COIN_MULTIPLIER = Math.floor(2 * (1 - HOUSE_EDGE) * 10000) / 10000; // 1.98

// ---------- Limbo: will a random multiplier reach your target? ----------
export function limboResult(hmac: string): number {
  const x = floatFromHex(hmac);
  const raw = (1 - HOUSE_EDGE) / (1 - x);
  return raw < 1 ? 1.0 : Math.floor(raw * 100) / 100;
}
export function limboWin(result: number, target: number): boolean {
  return result >= target;
}
export const LIMBO_TARGET_MIN = 1.01;
export const LIMBO_TARGET_MAX = 1000;

// ---------- Mines: reveal safe tiles, cash out before a mine ----------
export const MINES_TILES = 25;

/** Deterministic mine layout: sort tiles by a per-tile hash and take the first `mineCount`. */
export async function minesLayout(hmac: string, mineCount: number): Promise<number[]> {
  const keyed = await Promise.all(
    Array.from({ length: MINES_TILES }, async (_, tile) => ({
      tile,
      key: await sha256Hex(`${hmac}:${tile}`),
    })),
  );
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return keyed.slice(0, mineCount).map((k) => k.tile).sort((a, b) => a - b);
}

/** Payout multiplier after revealing `revealed` safe tiles with `mineCount` mines. */
export function minesMultiplier(revealed: number, mineCount: number): number {
  if (revealed <= 0) return 1.0;
  let fair = 1;
  for (let i = 0; i < revealed; i++) fair *= (MINES_TILES - i) / (MINES_TILES - mineCount - i);
  return Math.floor((1 - HOUSE_EDGE) * fair * 10000) / 10000;
}
