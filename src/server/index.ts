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
  limboResult, crashMultiplierAt,
  minesLayout, minesMultiplier, MINES_TILES,
  plinkoPath, plinkoBucket, plinkoMultiplier,
  rouletteNumber, rouletteColor, roulettePayout, type RouletteBet,
  wheelSegment, wheelMultiplier, WHEEL_SEGMENTS,
  kenoDraw, kenoMultiplier, KENO_POOL, KENO_MAX_PICKS,
  memoryDeck, MEMORY_DIFFICULTY,
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
    return { ...s, recent: recentBets(s.playerId), activeMines: activeMinesFor(s.playerId) };
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
    recordBet(p.id, "dice", p.nonce, `under ${target} → ${roll.toFixed(2)}`, bet, payout, win, p.server_seed_hash, p.client_seed);
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
    recordBet(p.id, "coinflip", p.nonce, `${side} → ${result}`, bet, payout, win, p.server_seed_hash, p.client_seed);
    return { game: "coinflip", result, side, win, multiplier: COIN_MULTIPLIER, betCents: bet, payoutCents: payout, balance, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

// ---------- Crash (live, SSE-driven, server-authoritative) ----------
const floor2 = (n: number) => Math.floor(n * 100) / 100;
interface CrashRound {
  playerId: string; stakeCents: number; crashPoint: number; startedAt: number;
  cashed: boolean; ended: boolean; nonce: number; serverSeedHash: string; clientSeed: string;
}
const crashRounds = new Map<string, CrashRound>();
const crashActive = new Map<string, string>();

app.post("/api/crash/start", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const bet = stakeCents(req.body?.stake);
    if (!(bet > 0)) throw new Error("Invalid stake");
    const prev = crashActive.get(p.id);
    if (prev) { crashRounds.delete(prev); crashActive.delete(p.id); }

    debitStake(p.id, p.nonce, bet);
    const crashPoint = limboResult(await betHmac(p.server_seed, p.client_seed, p.nonce)); // provably-fair bust point (hidden)
    const roundId = randomBytes(8).toString("hex");
    crashRounds.set(roundId, {
      playerId: p.id, stakeCents: bet, crashPoint, startedAt: Date.now(),
      cashed: false, ended: false, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed,
    });
    crashActive.set(p.id, roundId);
    return { roundId, betCents: bet, balance: getBalance(p.id), nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

// Live stream: pushes the rising multiplier, and the bust when it happens.
app.get("/api/crash/stream", (req, res) => {
  const r = crashRounds.get(String(req.query.roundId));
  if (!r || r.ended) { res.status(404).end(); return; }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const timer = setInterval(() => {
    if (r.ended || r.cashed) { clearInterval(timer); res.end(); return; }
    const m = crashMultiplierAt(Date.now() - r.startedAt);
    if (m >= r.crashPoint) {
      r.ended = true;
      recordBet(r.playerId, "crash", r.nonce, `busted @${floor2(r.crashPoint)}×`, r.stakeCents, 0, false, r.serverSeedHash, r.clientSeed);
      crashActive.delete(r.playerId);
      send("crash", { crashPoint: floor2(r.crashPoint) });
      clearInterval(timer); res.end();
    } else {
      send("tick", { multiplier: floor2(m) });
    }
  }, 100);
  req.on("close", () => clearInterval(timer));
});

app.post("/api/crash/cashout", (req, res) =>
  wrap(res, async () => {
    const r = crashRounds.get(String(req.body?.roundId));
    if (!r || r.ended || r.cashed) throw new Error("Round is over");
    const m = crashMultiplierAt(Date.now() - r.startedAt);
    if (m >= r.crashPoint) throw new Error("Too late — it already crashed");
    const mult = floor2(m);
    const payout = Math.floor(r.stakeCents * mult);
    r.cashed = true; r.ended = true;
    const balance = credit(r.playerId, payout);
    recordBet(r.playerId, "crash", r.nonce, `cashed @${mult}×`, r.stakeCents, payout, true, r.serverSeedHash, r.clientSeed);
    crashActive.delete(r.playerId);
    return { multiplier: mult, payoutCents: payout, balance };
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
    recordBet(p.id, "plinko", p.nonce, `bucket ${bucket} → ${mult}×`, bet, payout, payout > bet, p.server_seed_hash, p.client_seed);
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
    recordBet(p.id, "roulette", p.nonce, `${label} → ${n} ${rouletteColor(n)}`, bet, payout, payout > 0, p.server_seed_hash, p.client_seed);
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
    recordBet(p.id, "wheel", p.nonce, `segment ${seg} → ${mult}×`, bet, payout, payout > bet, p.server_seed_hash, p.client_seed);
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
    recordBet(p.id, "keno", p.nonce, `${hits}/${picks.length} hits → ${mult}×`, bet, payout, payout > bet, p.server_seed_hash, p.client_seed);
    return { game: "keno", draw, picks, hits, multiplier: mult, win: payout > bet, betCents: bet, payoutCents: payout, balance, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

// ---------- Mines (stateful round) ----------
interface MinesRound {
  playerId: string; stakeCents: number; mines: number; nonce: number;
  layout: Set<number>; revealed: number[]; serverSeedHash: string; clientSeed: string;
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
    rounds.set(roundId, { playerId: p.id, stakeCents: bet, mines, nonce: p.nonce, layout: new Set(layout), revealed: [], serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed });
    activeByPlayer.set(p.id, roundId);
    return { roundId, mines, tiles: MINES_TILES, betCents: bet, balance: getBalance(p.id), nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
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
      recordBet(round.playerId, "mines", round.nonce, `${round.mines} mines, hit after ${round.revealed.length} safe`, round.stakeCents, 0, false, round.serverSeedHash, round.clientSeed);
      endRound(String(req.body.roundId), round.playerId);
      return { mine: true, tile, layout: [...round.layout], multiplier: 0, balance: getBalance(round.playerId) };
    }
    round.revealed.push(tile);
    const mult = minesMultiplier(round.revealed.length, round.mines);
    const safeTotal = MINES_TILES - round.mines;
    if (round.revealed.length === safeTotal) {
      const payout = Math.floor(round.stakeCents * mult);
      const balance = credit(round.playerId, payout);
      recordBet(round.playerId, "mines", round.nonce, `${round.mines} mines, cleared all @${mult}×`, round.stakeCents, payout, true, round.serverSeedHash, round.clientSeed);
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
    recordBet(round.playerId, "mines", round.nonce, `${round.mines} mines, cashed ${round.revealed.length} safe @${mult}×`, round.stakeCents, payout, true, round.serverSeedHash, round.clientSeed);
    endRound(String(req.body.roundId), round.playerId);
    return { payoutCents: payout, multiplier: mult, balance, layout: [...round.layout] };
  }),
);

function endRound(roundId: string, playerId: string): void {
  rounds.delete(roundId);
  activeByPlayer.delete(playerId);
}

/** An in-progress Mines round for a player, so the client can resume after a reload. */
function activeMinesFor(playerId: string) {
  const roundId = activeByPlayer.get(playerId);
  if (!roundId) return null;
  const r = rounds.get(roundId);
  if (!r) return null;
  return {
    roundId,
    mines: r.mines,
    revealed: r.revealed,
    multiplier: minesMultiplier(r.revealed.length, r.mines),
    stakeCents: r.stakeCents,
    nonce: r.nonce,
    serverSeedHash: r.serverSeedHash,
    clientSeed: r.clientSeed,
  };
}

// ---------- Memory Match (server-authoritative skill bet) ----------
interface MemoryRound {
  playerId: string; stakeCents: number; pairs: number; budget: number; mult: number;
  nonce: number; serverSeedHash: string; clientSeed: string;
  deck: number[]; matched: Set<number>; moves: number; first: number | null;
}
const memRounds = new Map<string, MemoryRound>();
const memActive = new Map<string, string>();

app.post("/api/memory/start", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const d = MEMORY_DIFFICULTY[String(req.body?.difficulty)] || MEMORY_DIFFICULTY.easy;
    const bet = stakeCents(req.body?.stake);
    if (!(bet > 0)) throw new Error("Invalid stake");

    const prev = memActive.get(p.id); // abandoning a running game forfeits its stake
    if (prev) { memRounds.delete(prev); memActive.delete(p.id); }

    debitStake(p.id, p.nonce, bet);
    const deck = await memoryDeck(await betHmac(p.server_seed, p.client_seed, p.nonce), d.pairs);
    const roundId = randomBytes(8).toString("hex");
    memRounds.set(roundId, {
      playerId: p.id, stakeCents: bet, pairs: d.pairs, budget: d.budget, mult: d.mult,
      nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed,
      deck, matched: new Set(), moves: 0, first: null,
    });
    memActive.set(p.id, roundId);
    return {
      roundId, pairs: d.pairs, cols: d.cols, budget: d.budget, mult: d.mult, tiles: 2 * d.pairs,
      betCents: bet, balance: getBalance(p.id), nonce: p.nonce,
      serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed,
    };
  }),
);

app.post("/api/memory/flip", (req, res) =>
  wrap(res, async () => {
    const r = memRounds.get(String(req.body?.roundId));
    if (!r) throw new Error("No such game");
    const idx = Math.trunc(Number(req.body?.index));
    if (!(idx >= 0 && idx < 2 * r.pairs)) throw new Error("Bad card");
    if (r.matched.has(idx)) throw new Error("Already matched");

    // First card of the turn — reveal it, no move spent yet.
    if (r.first === null) {
      r.first = idx;
      return { index: idx, id: r.deck[idx], firstCard: true };
    }
    if (idx === r.first) throw new Error("Pick a different card");

    const firstIdx = r.first;
    r.first = null;
    r.moves++;
    const isMatch = r.deck[idx] === r.deck[firstIdx];
    if (isMatch) { r.matched.add(idx); r.matched.add(firstIdx); }
    const cleared = r.matched.size === 2 * r.pairs;

    const base = { index: idx, id: r.deck[idx], match: isMatch, moves: r.moves,
      ...(isMatch ? { matched: [firstIdx, idx] } : { first: firstIdx, second: idx }) };

    if (cleared) {
      const payout = Math.floor(r.stakeCents * r.mult);
      const balance = credit(r.playerId, payout);
      recordBet(r.playerId, "memory", r.nonce, `${r.pairs} pairs cleared in ${r.moves} moves @${r.mult}×`, r.stakeCents, payout, true, r.serverSeedHash, r.clientSeed);
      memRounds.delete(String(req.body.roundId)); memActive.delete(r.playerId);
      return { ...base, cleared: true, payoutCents: payout, balance, deck: r.deck };
    }
    if (r.moves >= r.budget) {
      recordBet(r.playerId, "memory", r.nonce, `${r.pairs} pairs, out of moves after ${r.moves}`, r.stakeCents, 0, false, r.serverSeedHash, r.clientSeed);
      memRounds.delete(String(req.body.roundId)); memActive.delete(r.playerId);
      return { ...base, busted: true, balance: getBalance(r.playerId), deck: r.deck };
    }
    return { ...base, movesLeft: r.budget - r.moves };
  }),
);

const PORT = Number(process.env.PORT) || 3300;
app.listen(PORT, () => console.log(`FairHouse casino running at http://localhost:${PORT}`));
