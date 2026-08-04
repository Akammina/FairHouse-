/**
 * Runs the REAL FairHouse TypeScript math and dumps a JSON of outcomes, which the
 * Python parity test (tests/test_parity.py) then reproduces byte-for-byte. This is
 * the honest link between the two codebases: the Python isn't a re-invention, it's
 * a verified mirror.
 *
 * Usage:  npx tsx math-lab/tools/gen_reference.ts > math-lab/tests/reference.json
 */
import { sha256Hex, betHmac, floatFromHex } from "../../src/shared/provablyFair.js";
import {
  diceRoll, diceMultiplier, coinResult, COIN_MULTIPLIER,
  limboResult, minesLayout, minesMultiplier, towerLayout, towerMultiplier,
  plinkoPath, plinkoBucket, plinkoMultiplier,
  rouletteNumber, rouletteColor, roulettePayout,
  wheelSegment, wheelMultiplier, kenoDraw, kenoMultiplier,
  slotSpin, slotPayout, shuffledDeck, pokerEvaluate, handValue,
  hiloHigherMult, hiloLowerMult,
} from "../../src/shared/games.js";

const SERVER = "server-seed-parity-fixture-2f9a";
const CLIENT = "player-client-seed";

async function main() {
  const bets = [];
  for (let nonce = 0; nonce < 12; nonce++) {
    const hmac = await betHmac(SERVER, CLIENT, nonce);
    bets.push({
      nonce,
      hmac,
      floatFromHex: floatFromHex(hmac),
      diceRoll: diceRoll(hmac),
      coin: coinResult(hmac),
      limbo: limboResult(hmac),
      rouletteNumber: rouletteNumber(hmac),
      rouletteColor: rouletteColor(rouletteNumber(hmac)),
      wheelSegment: wheelSegment(hmac),
      wheelMultiplier: wheelMultiplier(wheelSegment(hmac)),
      slotSpin: slotSpin(hmac),
      slotPayout: slotPayout(slotSpin(hmac)),
      plinkoPath: plinkoPath(hmac),
      plinkoBucket: plinkoBucket(plinkoPath(hmac)),
      plinkoMultiplier: plinkoMultiplier(plinkoBucket(plinkoPath(hmac))),
      minesLayout3: await minesLayout(hmac, 3),
      towerEasy: await towerLayout(hmac, 4, 1, 9),
      towerExpert: await towerLayout(hmac, 3, 2, 9),
      kenoDraw: await kenoDraw(hmac),
      deckFirst10: (await shuffledDeck(hmac)).slice(0, 10),
    });
  }

  // scalar / paytable checks that don't depend on a seed
  const scalars = {
    sha256_sample: await sha256Hex("sample-123"),
    diceMultiplier: [2, 25, 50, 98].map((t) => [t, diceMultiplier(t)]),
    coinMultiplier: COIN_MULTIPLIER,
    minesMultiplier: [[1, 3], [5, 3], [10, 5], [24, 1]].map(([r, m]) => [r, m, minesMultiplier(r, m)]),
    towerMultiplier: ["easy", "medium", "hard", "expert"].map((d) => [d, towerMultiplier(d, 9)]),
    kenoMultiplier: [[10, 10], [8, 5], [5, 3], [1, 1]].map(([s, h]) => [s, h, kenoMultiplier(s, h)]),
    hiloHigher: [0, 6, 12].map((r) => [r, hiloHigherMult(r)]),
    hiloLower: [0, 6, 12].map((r) => [r, hiloLowerMult(r)]),
    poker: [
      [0, 13, 26, 39, 12],   // 2♠ 2♥ 2♦ 2♣ A♠ -> four of a kind
      [8, 9, 10, 11, 12],    // 10 J Q K A same? ranks only -> straight (mixed suits here)
      [0, 1, 2, 3, 4],       // 2..6 straight
    ].map((h) => [h, pokerEvaluate(h)]),
    handValue: [
      [[12, 25], "A + A"],   // A♠ A♥ -> 12 (one ace soft)
      [[12, 8], "A + 10"],   // blackjack -> 21
      [[10, 11, 12], "K Q A"],
    ].map(([h]) => [h, handValue(h as number[])]),
  };

  process.stdout.write(JSON.stringify({ server: SERVER, client: CLIENT, bets, scalars }, null, 2));
}

main();
