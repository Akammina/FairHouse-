/**
 * FairHouse server — one wallet, one fairness engine, four games.
 *
 * Instant games (dice, coinflip, limbo) resolve in a single request: derive the
 * outcome from the committed seed, debit the stake and advance the nonce
 * atomically, credit any win. Mines is a multi-step round: the mine layout is
 * fixed from the seed at start (so it's provably fair), then each reveal checks
 * against it until the player cashes out or hits a mine.
 */
import express from "express";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { betHmac } from "../shared/provablyFair.js";
import {
  diceRoll, diceMultiplier, diceWin, DICE_TARGET_MIN, DICE_TARGET_MAX,
  coinResult, COIN_MULTIPLIER, type Coin,
  limboResult, limboWin, LIMBO_TARGET_MIN, LIMBO_TARGET_MAX,
  minesLayout, minesMultiplier, MINES_TILES,
  plinkoPath, plinkoBucket, plinkoMultiplier,
  rouletteNumber, rouletteColor, roulettePayout, type RouletteBet,
  wheelSegment, wheelMultiplier, WHEEL_SEGMENTS,
  kenoDraw, kenoMultiplier, KENO_POOL, KENO_MAX_PICKS,
} from "../shared/games.js";
import {
  ensureSession, getPlayer, getBalance, debitStake, credit, recordBet,
  rotateSeed, recentBets,
} from "./ledger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "../../public")));
app.use("/shared", express.static(join(__dirname, "../shared")));

const stakeCents = (stake: unknown) => Math.round(Number(stake) * 100);
function requirePlayer(id: unknown) {
  const p = getPlayer(String(id));
  if (!p) throw new Error("Unknown player — start a session first");
  return p;
}
const wrap = (res: express.Response, fn: () => Promise<unknown>) =>
  fn().then((v) => res.json(v)).catch((e) => res.status(400).json({ error: (e as Error).message }));

// ---------- Session & fairness ----------
app.post("/api/session", (req, res) =>
  wrap(res, async () => {
    const s = await ensureSession(req.body?.playerId);
    return { ...s, recent: recentBets(s.playerId) };
  }),
);
app.post("/api/rotate", (req, res) =>
  wrap(res, async () => {
    requirePlayer(req.body?.playerId);
    return rotateSeed(String(req.body.playerId), req.body?.clientSeed ? String(req.body.clientSeed) : undefined);
  }),
);

// ---------- Instant games ----------
app.post("/api/dice/bet", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const target = Number(req.body?.target);
    const bet = stakeCents(req.body?.stake);
    if (!(target >= DICE_TARGET_MIN && target <= DICE_TARGET_MAX)) throw new Error(`Target ${DICE_TARGET_MIN}–${DICE_TARGET_MAX}`);
    if (!(bet > 0)) throw new Error("Invalid stake");
    const roll = diceRoll(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const win = diceWin(roll, target);
    const mult = diceMultiplier(target);
    const payout = win ? Math.floor(bet * mult) : 0;
    debitStake(p.id, p.nonce, bet);
    const balance = win ? credit(p.id, payout) : getBalance(p.id);
    recordBet(p.id, "dice", p.nonce, `under ${target} → ${roll.toFixed(2)}`, bet, payout, win);
    return { game: "dice", roll, target, win, multiplier: mult, betCents: bet, payoutCents: payout, balance, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

app.post("/api/coinflip/bet", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const side = String(req.body?.side) as Coin;
    const bet = stakeCents(req.body?.stake);
    if (side !== "heads" && side !== "tails") throw new Error("Pick heads or tails");
    if (!(bet > 0)) throw new Error("Invalid stake");
    const result = coinResult(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const win = result === side;
    const payout = win ? Math.floor(bet * COIN_MULTIPLIER) : 0;
    debitStake(p.id, p.nonce, bet);
    const balance = win ? credit(p.id, payout) : getBalance(p.id);
    recordBet(p.id, "coinflip", p.nonce, `${side} → ${result}`, bet, payout, win);
    return { game: "coinflip", result, side, win, multiplier: COIN_MULTIPLIER, betCents: bet, payoutCents: payout, balance, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

app.post("/api/limbo/bet", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const target = Number(req.body?.target);
    const bet = stakeCents(req.body?.stake);
    if (!(target >= LIMBO_TARGET_MIN && target <= LIMBO_TARGET_MAX)) throw new Error(`Target ${LIMBO_TARGET_MIN}–${LIMBO_TARGET_MAX}`);
    if (!(bet > 0)) throw new Error("Invalid stake");
    const result = limboResult(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const win = limboWin(result, target);
    const payout = win ? Math.floor(bet * target) : 0;
    debitStake(p.id, p.nonce, bet);
    const balance = win ? credit(p.id, payout) : getBalance(p.id);
    recordBet(p.id, "limbo", p.nonce, `@${target}× → ${result}×`, bet, payout, win);
    return { game: "limbo", result, target, win, multiplier: target, betCents: bet, payoutCents: payout, balance, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

app.post("/api/plinko/bet", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const bet = stakeCents(req.body?.stake);
    if (!(bet > 0)) throw new Error("Invalid stake");
    const path = plinkoPath(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const bucket = plinkoBucket(path);
    const mult = plinkoMultiplier(bucket);
    const payout = Math.floor(bet * mult);
    debitStake(p.id, p.nonce, bet);
    const balance = payout > 0 ? credit(p.id, payout) : getBalance(p.id);
    recordBet(p.id, "plinko", p.nonce, `bucket ${bucket} → ${mult}×`, bet, payout, payout > bet);
    return { game: "plinko", path, bucket, multiplier: mult, win: payout > bet, betCents: bet, payoutCents: payout, balance, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

const ROULETTE_TYPES = ["straight", "red", "black", "odd", "even", "low", "high", "dozen1", "dozen2", "dozen3"];
app.post("/api/roulette/bet", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const bet = stakeCents(req.body?.stake);
    const spec = req.body?.bet;
    if (!(bet > 0)) throw new Error("Invalid stake");
    if (!spec || !ROULETTE_TYPES.includes(spec.type)) throw new Error("Pick a bet");
    if (spec.type === "straight" && !(Number.isInteger(spec.number) && spec.number >= 0 && spec.number <= 36)) throw new Error("Number 0–36");
    const n = rouletteNumber(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const mult = roulettePayout(n, spec as RouletteBet);
    const payout = Math.floor(bet * mult);
    debitStake(p.id, p.nonce, bet);
    const balance = payout > 0 ? credit(p.id, payout) : getBalance(p.id);
    const label = spec.type === "straight" ? `#${spec.number}` : spec.type;
    recordBet(p.id, "roulette", p.nonce, `${label} → ${n} ${rouletteColor(n)}`, bet, payout, payout > 0);
    return { game: "roulette", number: n, color: rouletteColor(n), bet: spec, multiplier: mult, win: payout > 0, betCents: bet, payoutCents: payout, balance, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

app.post("/api/wheel/bet", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const bet = stakeCents(req.body?.stake);
    if (!(bet > 0)) throw new Error("Invalid stake");
    const seg = wheelSegment(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const mult = wheelMultiplier(seg);
    const payout = Math.floor(bet * mult);
    debitStake(p.id, p.nonce, bet);
    const balance = payout > 0 ? credit(p.id, payout) : getBalance(p.id);
    recordBet(p.id, "wheel", p.nonce, `segment ${seg} → ${mult}×`, bet, payout, payout > bet);
    return { game: "wheel", segment: seg, segments: WHEEL_SEGMENTS, multiplier: mult, win: payout > bet, betCents: bet, payoutCents: payout, balance, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

app.post("/api/keno/bet", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const bet = stakeCents(req.body?.stake);
    const picks = Array.isArray(req.body?.picks) ? req.body.picks.map(Number) : [];
    if (!(bet > 0)) throw new Error("Invalid stake");
    const unique = [...new Set(picks)];
    if (unique.length !== picks.length || picks.length < 1 || picks.length > KENO_MAX_PICKS) throw new Error(`Pick 1–${KENO_MAX_PICKS} numbers`);
    if (!picks.every((n: number) => Number.isInteger(n) && n >= 1 && n <= KENO_POOL)) throw new Error("Bad numbers");
    const draw = await kenoDraw(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const hits = picks.filter((n: number) => draw.includes(n)).length;
    const mult = kenoMultiplier(picks.length, hits);
    const payout = Math.floor(bet * mult);
    debitStake(p.id, p.nonce, bet);
    const balance = payout > 0 ? credit(p.id, payout) : getBalance(p.id);
    recordBet(p.id, "keno", p.nonce, `${hits}/${picks.length} hits → ${mult}×`, bet, payout, payout > bet);
    return { game: "keno", draw, picks, hits, multiplier: mult, win: payout > bet, betCents: bet, payoutCents: payout, balance, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

// ---------- Mines (stateful round) ----------
interface MinesRound {
  playerId: string; stakeCents: number; mines: number; nonce: number;
  layout: Set<number>; revealed: number[];
}
const rounds = new Map<string, MinesRound>();
const activeByPlayer = new Map<string, string>();

app.post("/api/mines/start", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const mines = Math.trunc(Number(req.body?.mines));
    const bet = stakeCents(req.body?.stake);
    if (!(mines >= 1 && mines <= 24)) throw new Error("Mines must be 1–24");
    if (!(bet > 0)) throw new Error("Invalid stake");
    if (activeByPlayer.has(p.id)) throw new Error("Finish your current Mines game first");
    debitStake(p.id, p.nonce, bet); // reserve stake + advance nonce
    const layout = await minesLayout(await betHmac(p.server_seed, p.client_seed, p.nonce), mines);
    const roundId = randomBytes(8).toString("hex");
    rounds.set(roundId, { playerId: p.id, stakeCents: bet, mines, nonce: p.nonce, layout: new Set(layout), revealed: [] });
    activeByPlayer.set(p.id, roundId);
    return { roundId, mines, tiles: MINES_TILES, betCents: bet, balance: getBalance(p.id), nonce: p.nonce };
  }),
);

app.post("/api/mines/reveal", (req, res) =>
  wrap(res, async () => {
    const round = rounds.get(String(req.body?.roundId));
    if (!round) throw new Error("No such round");
    const tile = Math.trunc(Number(req.body?.tile));
    if (!(tile >= 0 && tile < MINES_TILES)) throw new Error("Bad tile");
    if (round.revealed.includes(tile)) throw new Error("Already revealed");

    if (round.layout.has(tile)) {
      recordBet(round.playerId, "mines", round.nonce, `${round.mines} mines, hit after ${round.revealed.length} safe`, round.stakeCents, 0, false);
      endRound(String(req.body.roundId), round.playerId);
      return { mine: true, tile, layout: [...round.layout], multiplier: 0, balance: getBalance(round.playerId) };
    }
    round.revealed.push(tile);
    const mult = minesMultiplier(round.revealed.length, round.mines);
    const safeTotal = MINES_TILES - round.mines;
    if (round.revealed.length === safeTotal) {
      const payout = Math.floor(round.stakeCents * mult);
      const balance = credit(round.playerId, payout);
      recordBet(round.playerId, "mines", round.nonce, `${round.mines} mines, cleared all @${mult}×`, round.stakeCents, payout, true);
      endRound(String(req.body.roundId), round.playerId);
      return { mine: false, tile, revealedCount: round.revealed.length, multiplier: mult, cashedOut: true, payoutCents: payout, balance, layout: [...round.layout] };
    }
    return { mine: false, tile, revealedCount: round.revealed.length, multiplier: mult, nextMultiplier: minesMultiplier(round.revealed.length + 1, round.mines) };
  }),
);

app.post("/api/mines/cashout", (req, res) =>
  wrap(res, async () => {
    const round = rounds.get(String(req.body?.roundId));
    if (!round) throw new Error("No such round");
    if (round.revealed.length < 1) throw new Error("Reveal at least one tile first");
    const mult = minesMultiplier(round.revealed.length, round.mines);
    const payout = Math.floor(round.stakeCents * mult);
    const balance = credit(round.playerId, payout);
    recordBet(round.playerId, "mines", round.nonce, `${round.mines} mines, cashed ${round.revealed.length} safe @${mult}×`, round.stakeCents, payout, true);
    endRound(String(req.body.roundId), round.playerId);
    return { payoutCents: payout, multiplier: mult, balance, layout: [...round.layout] };
  }),
);

function endRound(roundId: string, playerId: string): void {
  rounds.delete(roundId);
  activeByPlayer.delete(playerId);
}

const PORT = Number(process.env.PORT) || 3300;
app.listen(PORT, () => console.log(`FairHouse casino running at http://localhost:${PORT}`));
