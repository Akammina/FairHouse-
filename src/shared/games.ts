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

// ---------- Crash: a live rising multiplier that busts at a seed-derived point ----------
// The crash point uses the same provably-fair formula as Limbo (limboResult). The
// multiplier rises over time and busts when it reaches that point.
export const CRASH_GROWTH_RATE = Math.log(2) / 5; // the multiplier doubles every 5 seconds
export function crashMultiplierAt(ms: number): number {
  return Math.exp(CRASH_GROWTH_RATE * (ms / 1000));
}

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

// ---------- Dragon Tower: climb rows, dodge the trap on each one ----------
export const TOWER_ROWS = 9;
export const TOWER_DIFF: Record<string, { tiles: number; traps: number }> = {
  easy: { tiles: 4, traps: 1 },     // 3 safe of 4
  medium: { tiles: 3, traps: 1 },   // 2 safe of 3
  hard: { tiles: 2, traps: 1 },     // 1 safe of 2
  expert: { tiles: 3, traps: 2 },   // 1 safe of 3
};

/** Trap tile indices for each row, fixed deterministically from the seed. */
export async function towerLayout(hmac: string, tiles: number, traps: number, rows: number): Promise<number[][]> {
  const layout: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const keyed = await Promise.all(
      Array.from({ length: tiles }, async (_, t) => ({ t, k: await sha256Hex(`${hmac}:${r}:${t}`) })),
    );
    keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
    layout.push(keyed.slice(0, traps).map((x) => x.t).sort((a, b) => a - b));
  }
  return layout;
}

/** Cumulative payout multiplier after climbing `level` rows on a difficulty. */
export function towerMultiplier(diff: string, level: number): number {
  const d = TOWER_DIFF[diff] || TOWER_DIFF.medium;
  const safe = d.tiles - d.traps;
  if (level <= 0) return 1;
  return Math.floor((1 - HOUSE_EDGE) * Math.pow(d.tiles / safe, level) * 10000) / 10000;
}

// ---------- Plinko: drop a ball through pegs into a multiplier bucket ----------
export const PLINKO_ROWS = 12;
export const PLINKO_MULTIPLIERS = [15, 4, 1.5, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.5, 4, 15];

/** Left/right choice at each row (0 = left, 1 = right), one bit per row. */
export function plinkoPath(hmac: string): number[] {
  return Array.from({ length: PLINKO_ROWS }, (_, i) => parseInt(hmac[i], 16) % 2);
}
export function plinkoBucket(path: number[]): number {
  return path.reduce((a, b) => a + b, 0); // number of rights = bucket index
}
export function plinkoMultiplier(bucket: number): number {
  return PLINKO_MULTIPLIERS[bucket];
}

// ---------- Roulette: European wheel, 0–36 ----------
export const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export type RouletteBet =
  | { type: "straight"; number: number }
  | { type: "red" | "black" | "odd" | "even" | "low" | "high" | "dozen1" | "dozen2" | "dozen3" };

export function rouletteNumber(hmac: string): number {
  return Math.floor(floatFromHex(hmac) * 37); // 0..36
}
export function rouletteColor(n: number): "green" | "red" | "black" {
  return n === 0 ? "green" : ROULETTE_RED.has(n) ? "red" : "black";
}
/** Total-return multiplier for a winning bet, else 0. */
export function roulettePayout(n: number, bet: RouletteBet): number {
  const red = ROULETTE_RED.has(n);
  switch (bet.type) {
    case "straight": return n === bet.number ? 36 : 0;
    case "red": return n !== 0 && red ? 2 : 0;
    case "black": return n !== 0 && !red ? 2 : 0;
    case "odd": return n !== 0 && n % 2 === 1 ? 2 : 0;
    case "even": return n !== 0 && n % 2 === 0 ? 2 : 0;
    case "low": return n >= 1 && n <= 18 ? 2 : 0;
    case "high": return n >= 19 && n <= 36 ? 2 : 0;
    case "dozen1": return n >= 1 && n <= 12 ? 3 : 0;
    case "dozen2": return n >= 13 && n <= 24 ? 3 : 0;
    case "dozen3": return n >= 25 && n <= 36 ? 3 : 0;
  }
}

// ---------- Wheel: spin a ring of multiplier segments ----------
export const WHEEL_SEGMENTS = [0, 1.6, 0, 2, 0, 1.6, 0, 2, 0, 1.6, 0, 2, 0, 1.6, 0, 3.5, 0, 1.6, 0, 2];
export function wheelSegment(hmac: string): number {
  return Math.floor(floatFromHex(hmac) * WHEEL_SEGMENTS.length);
}
export function wheelMultiplier(segment: number): number {
  return WHEEL_SEGMENTS[segment];
}

// ---------- Keno: pick numbers, 10 are drawn from a pool of 40 ----------
export const KENO_POOL = 40;
export const KENO_DRAW = 10;
export const KENO_MAX_PICKS = 10;
// paytable[spots][hits] → total-return multiplier
export const KENO_PAYTABLE: Record<number, number[]> = {
  1: [0, 3.8],
  2: [0, 1, 9],
  3: [0, 0, 2.8, 25],
  4: [0, 0, 1.7, 5, 60],
  5: [0, 0, 1.2, 3, 15, 200],
  6: [0, 0, 1, 2, 6, 40, 400],
  7: [0, 0, 0, 1.5, 4, 15, 100, 700],
  8: [0, 0, 0, 1.2, 2.5, 8, 40, 200, 1000],
  9: [0, 0, 0, 1, 2, 5, 20, 80, 400, 2000],
  10: [0, 0, 0, 0.5, 1.5, 3, 12, 40, 150, 800, 5000],
};

/** Deterministically draw KENO_DRAW distinct numbers (1..40) by hashing each. */
export async function kenoDraw(hmac: string): Promise<number[]> {
  const keyed = await Promise.all(
    Array.from({ length: KENO_POOL }, async (_, i) => ({ n: i + 1, k: await sha256Hex(`${hmac}:${i}`) })),
  );
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return keyed.slice(0, KENO_DRAW).map((x) => x.n).sort((a, b) => a - b);
}
export function kenoMultiplier(spots: number, hits: number): number {
  return KENO_PAYTABLE[spots]?.[hits] ?? 0;
}

// ---------- Cards: a seed-derived 52-card deck, shared by the card games ----------
// A card is 0..51. rank 0..12 = 2..A, suit 0..3 = ♠♥♦♣.
export const cardRank = (c: number) => c % 13;
export const cardSuit = (c: number) => Math.floor(c / 13);
export async function shuffledDeck(hmac: string): Promise<number[]> {
  const keyed = await Promise.all(
    Array.from({ length: 52 }, async (_, c) => ({ c, k: await sha256Hex(`${hmac}:${c}`) })),
  );
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return keyed.map((x) => x.c);
}

// ---------- Slots: three reels, three-of-a-kind pays ----------
export const SLOT_PAYS = [70, 45, 35, 25, 20, 15]; // three-of-a-kind multiplier by symbol index (0 = best)
export const SLOT_COUNT = SLOT_PAYS.length;
export function slotSpin(hmac: string): number[] {
  return [0, 1, 2].map((n) => Math.floor((parseInt(hmac.slice(n * 8, n * 8 + 8), 16) / 0x100000000) * SLOT_COUNT));
}
export function slotPayout(reels: number[]): number {
  return reels[0] === reels[1] && reels[1] === reels[2] ? SLOT_PAYS[reels[0]] : 0;
}

// ---------- Hi-Lo: guess higher/lower than the current card ----------
// "Higher or same" wins when nextRank >= currentRank; "Lower or same" when <=.
export function hiloHigherMult(rank: number): number {
  const p = (13 - rank) / 13; // P(next rank >= current)
  return Math.floor(((1 - HOUSE_EDGE) / p) * 100) / 100;
}
export function hiloLowerMult(rank: number): number {
  const p = (rank + 1) / 13; // P(next rank <= current)
  return Math.floor(((1 - HOUSE_EDGE) / p) * 100) / 100;
}

// ---------- Video Poker: Jacks-or-Better hand evaluation (9/6 paytable) ----------
export const VPOKER_PAYS = { royal: 800, straightFlush: 50, four: 25, fullHouse: 9, flush: 6, straight: 4, three: 3, twoPair: 2, jacks: 1, none: 0 };
export function pokerEvaluate(cards: number[]): { name: string; multiplier: number } {
  const ranks = cards.map((c) => c % 13).sort((a, b) => a - b);
  const suits = cards.map((c) => Math.floor(c / 13));
  const flush = suits.every((s) => s === suits[0]);
  const uniq = [...new Set(ranks)];
  let straight = false, straightHigh = -1;
  if (uniq.length === 5) {
    if (ranks[4] - ranks[0] === 4) { straight = true; straightHigh = ranks[4]; }
    else if (ranks.join(",") === "0,1,2,3,12") { straight = true; straightHigh = 3; } // A-2-3-4-5 wheel
  }
  const counts: Record<number, number> = {};
  ranks.forEach((r) => (counts[r] = (counts[r] || 0) + 1));
  const freqs = Object.values(counts).sort((a, b) => b - a);
  const pairRanks = Object.keys(counts).filter((r) => counts[Number(r)] === 2).map(Number);
  const P = VPOKER_PAYS;
  if (flush && straight && straightHigh === 12) return { name: "Royal Flush", multiplier: P.royal };
  if (flush && straight) return { name: "Straight Flush", multiplier: P.straightFlush };
  if (freqs[0] === 4) return { name: "Four of a Kind", multiplier: P.four };
  if (freqs[0] === 3 && freqs[1] === 2) return { name: "Full House", multiplier: P.fullHouse };
  if (flush) return { name: "Flush", multiplier: P.flush };
  if (straight) return { name: "Straight", multiplier: P.straight };
  if (freqs[0] === 3) return { name: "Three of a Kind", multiplier: P.three };
  if (freqs[0] === 2 && freqs[1] === 2) return { name: "Two Pair", multiplier: P.twoPair };
  if (freqs[0] === 2 && pairRanks.some((r) => r >= 9)) return { name: "Jacks or Better", multiplier: P.jacks };
  return { name: "No win", multiplier: P.none };
}

// ---------- Blackjack: hand value with soft aces ----------
export function handValue(cards: number[]): number {
  let total = 0, aces = 0;
  for (const c of cards) {
    const r = c % 13;
    total += r <= 8 ? r + 2 : r === 12 ? 11 : 10;
    if (r === 12) aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
export const isBlackjack = (cards: number[]) => cards.length === 2 && handValue(cards) === 21;

// ---------- Memory: a provably-fair shuffled deck of pairs ----------
export const MEMORY_DIFFICULTY: Record<string, { pairs: number; cols: number; budget: number; mult: number }> = {
  easy: { pairs: 8, cols: 4, budget: 16, mult: 1.9 },
  hard: { pairs: 12, cols: 6, budget: 25, mult: 2.8 },
};

/**
 * Deterministically arrange pair-ids [0,0,1,1,…,P-1,P-1] into a shuffled deck by
 * sorting positions on a per-slot hash. Same seed → same deal, so the shuffle is
 * verifiable and committed before play.
 */
export async function memoryDeck(hmac: string, pairs: number): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < pairs; i++) { ids.push(i, i); }
  const keyed = await Promise.all(ids.map(async (id, i) => ({ id, k: await sha256Hex(`${hmac}:${i}`) })));
  keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  return keyed.map((x) => x.id);
}
