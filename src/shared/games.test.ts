import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "./provablyFair.js";
import {
  diceRoll, diceMultiplier, diceWin,
  coinResult, COIN_MULTIPLIER,
  limboResult, limboWin,
  minesLayout, minesMultiplier, MINES_TILES,
  plinkoPath, plinkoBucket, plinkoMultiplier, PLINKO_ROWS, PLINKO_MULTIPLIERS,
  rouletteNumber, rouletteColor, roulettePayout,
  wheelSegment, wheelMultiplier, WHEEL_SEGMENTS,
  kenoDraw, kenoMultiplier, KENO_DRAW, KENO_POOL,
  pokerEvaluate, handValue, isBlackjack,
} from "./games.js";

// card = suit*13 + rank; rank 0..12 = 2..A, suit 0..3 = ♠♥♦♣
const card = (rank: number, suit: number) => suit * 13 + rank;

// helper: deterministic pseudo-digests for distribution checks
const digest = (i: number) => sha256Hex(`sample-${i}`);

test("dice roll is in [0,100) and scales correctly", () => {
  assert.equal(diceRoll("00000000"), 0);
  assert.equal(diceRoll("80000000"), 50);
  assert.equal(diceRoll("ffffffff"), 99.99);
});
test("dice multiplier carries the edge and win is roll-under", () => {
  assert.ok(Math.abs(diceMultiplier(50) - 1.98) < 0.01);
  assert.equal(diceWin(49.99, 50), true);
  assert.equal(diceWin(50, 50), false);
});

test("coin multiplier is 1.98 and result is ~50/50", async () => {
  assert.equal(COIN_MULTIPLIER, 1.98);
  let heads = 0;
  const N = 500;
  for (let i = 0; i < N; i++) if (coinResult(await digest(i)) === "heads") heads++;
  const pct = (heads / N) * 100;
  assert.ok(Math.abs(pct - 50) < 8, `heads ${pct}%`);
});

test("limbo result is >= 1 and reaches 2x about half the time", async () => {
  let reached2 = 0;
  const N = 600;
  for (let i = 0; i < N; i++) {
    const m = limboResult(await digest(i));
    assert.ok(m >= 1);
    if (limboWin(m, 2)) reached2++;
  }
  const pct = (reached2 / N) * 100;
  assert.ok(Math.abs(pct - 49.5) < 8, `reached 2x ${pct}%`);
});

test("mines layout has the right count, unique tiles, and is deterministic", async () => {
  const hmac = await sha256Hex("layout-seed");
  const a = await minesLayout(hmac, 5);
  const b = await minesLayout(hmac, 5);
  assert.deepEqual(a, b); // deterministic
  assert.equal(a.length, 5);
  assert.equal(new Set(a).size, 5); // unique
  assert.ok(a.every((t) => t >= 0 && t < MINES_TILES));
});

test("mines multiplier grows with each safe reveal", () => {
  assert.equal(minesMultiplier(0, 3), 1.0);
  const m1 = minesMultiplier(1, 3);
  const m2 = minesMultiplier(2, 3);
  assert.ok(m1 > 1 && m2 > m1);
  // first safe pick with 3 mines ≈ (1-edge) * 25/22
  assert.ok(Math.abs(m1 - 0.99 * (25 / 22)) < 0.01);
});

test("plinko path has one bit per row and the bucket is the number of rights", () => {
  const path = plinkoPath("0f1e2d3c4b5a6978");
  assert.equal(path.length, PLINKO_ROWS);
  assert.ok(path.every((b) => b === 0 || b === 1));
  assert.equal(plinkoBucket([1, 0, 1, 1, 0]), 3);
  assert.equal(plinkoMultiplier(0), PLINKO_MULTIPLIERS[0]); // edge bucket is the big one
  assert.ok(plinkoMultiplier(PLINKO_ROWS / 2) < 1); // center bucket loses on average
});

test("plinko payout table keeps a house edge", () => {
  // EV = Σ C(n,k)/2^n · mult[k] should be < 1
  const n = PLINKO_ROWS;
  const choose = (a: number, b: number) => { let r = 1; for (let i = 0; i < b; i++) r = (r * (a - i)) / (i + 1); return r; };
  let ev = 0;
  for (let k = 0; k <= n; k++) ev += (choose(n, k) / 2 ** n) * PLINKO_MULTIPLIERS[k];
  assert.ok(ev > 0.9 && ev < 1.0, `plinko EV ${ev}`);
});

test("roulette number is 0–36 with correct colors and payouts", () => {
  assert.equal(rouletteNumber("00000000000000"), 0);
  assert.equal(rouletteColor(0), "green");
  assert.equal(rouletteColor(1), "red");
  assert.equal(rouletteColor(2), "black");
  assert.equal(roulettePayout(17, { type: "straight", number: 17 }), 36);
  assert.equal(roulettePayout(18, { type: "straight", number: 17 }), 0);
  assert.equal(roulettePayout(0, { type: "red" }), 0); // zero loses even-money bets
  assert.equal(roulettePayout(3, { type: "red" }), 2);
  assert.equal(roulettePayout(20, { type: "dozen2" }), 3);
});

test("wheel lands on a segment and keeps a house edge", () => {
  const seg = wheelSegment("ffffffffffffff");
  assert.ok(seg >= 0 && seg < WHEEL_SEGMENTS.length);
  assert.equal(wheelMultiplier(seg), WHEEL_SEGMENTS[seg]);
  const ev = WHEEL_SEGMENTS.reduce((a, b) => a + b, 0) / WHEEL_SEGMENTS.length;
  assert.ok(ev > 0.9 && ev < 1.0, `wheel EV ${ev}`);
});

test("poker evaluator ranks hands correctly", () => {
  const royal = [8, 9, 10, 11, 12].map((r) => card(r, 0)); // 10-J-Q-K-A spades
  assert.equal(pokerEvaluate(royal).name, "Royal Flush");
  const sf = [0, 1, 2, 3, 4].map((r) => card(r, 1)); // 2-6 hearts
  assert.equal(pokerEvaluate(sf).name, "Straight Flush");
  assert.equal(pokerEvaluate([card(1, 0), card(1, 1), card(1, 2), card(11, 0), card(11, 1)]).name, "Full House");
  assert.equal(pokerEvaluate([card(9, 0), card(9, 1), card(0, 0), card(3, 1), card(7, 2)]).name, "Jacks or Better");
  assert.equal(pokerEvaluate([card(5, 0), card(5, 1), card(0, 0), card(3, 1), card(7, 2)]).multiplier, 0); // pair of 7s, no win
  assert.equal(pokerEvaluate([card(2, 0), card(2, 1), card(5, 0), card(5, 2), card(9, 3)]).name, "Two Pair");
  // A-2-3-4-5 wheel straight
  assert.equal(pokerEvaluate([card(12, 0), card(0, 1), card(1, 2), card(2, 3), card(3, 0)]).name, "Straight");
});

test("blackjack hand value handles soft aces", () => {
  assert.equal(handValue([card(12, 0), card(11, 0)]), 21); // A + K
  assert.ok(isBlackjack([card(12, 0), card(8, 1)])); // A + 10
  assert.equal(handValue([card(12, 0), card(12, 1), card(7, 0)]), 21); // A+A+9 → 11+1+9
  assert.equal(handValue([card(8, 0), card(5, 1), card(3, 2)]), 22); // 10+7+5 bust
});

test("keno draws 10 distinct numbers deterministically and scores hits", async () => {
  const hmac = await sha256Hex("keno-seed");
  const a = await kenoDraw(hmac);
  const b = await kenoDraw(hmac);
  assert.deepEqual(a, b);
  assert.equal(a.length, KENO_DRAW);
  assert.equal(new Set(a).size, KENO_DRAW);
  assert.ok(a.every((n) => n >= 1 && n <= KENO_POOL));
  assert.equal(kenoMultiplier(10, 10), 5000);
  assert.equal(kenoMultiplier(2, 0), 0);
});
