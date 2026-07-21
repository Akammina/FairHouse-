import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "./provablyFair.js";
import {
  diceRoll, diceMultiplier, diceWin,
  coinResult, COIN_MULTIPLIER,
  limboResult, limboWin,
  minesLayout, minesMultiplier, MINES_TILES,
} from "./games.js";

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
