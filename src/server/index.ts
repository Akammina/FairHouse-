/**
 * FairHouse server: one wallet, one fairness engine, thirteen games.
 *
 * Instant games (dice, coinflip, slots, plinko, roulette, wheel, keno) resolve
 * in a single request: derive the outcome from the committed seed, debit the
 * stake and advance the nonce atomically, credit any win. Crash is a live,
 * SSE-driven round. Mines, Memory, Hi-Lo, Video Poker and Blackjack are
 * stateful multi-step rounds: the seed fixes the layout/deck at start (so it's
 * provably fair), then each action checks against it until the player cashes
 * out, busts, or the hand resolves.
 */
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { betHmac } from "../shared/provablyFair.js";
import {
  diceRoll, diceMultiplier, diceWin, DICE_TARGET_MIN, DICE_TARGET_MAX,
  coinResult, COIN_MULTIPLIER, type Coin,
  limboResult, crashMultiplierAt,
  minesLayout, minesMultiplier, MINES_TILES,
  towerLayout, towerMultiplier, TOWER_DIFF, TOWER_ROWS,
  plinkoPath, plinkoBucket, plinkoMultiplier,
  rouletteNumber, rouletteColor, roulettePayout, type RouletteBet,
  wheelSegment, wheelMultiplier, WHEEL_SEGMENTS,
  kenoDraw, kenoMultiplier, KENO_POOL, KENO_MAX_PICKS,
  memoryDeck, MEMORY_DIFFICULTY,
  slotSpin, slotPayout,
  shuffledDeck, cardRank,
  hiloHigherMult, hiloLowerMult,
  pokerEvaluate, handValue, isBlackjack,
} from "../shared/games.js";
import {
  ensureSession, getPlayer, getBalance, debitStake, debitExtra, credit, recordBet,
  rotateSeed, recentBets, recentWins, leaderboard, topUp,
} from "./ledger.js";
import { addFeedClient } from "./feed.js";
import { noteContext, isGameBlocked } from "./security.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1); // Render terminates TLS in front of us; trust one proxy hop for real client IPs

// Security headers. CSP allows same-origin scripts/styles (the app uses inline style attributes).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null, // don't force https on localhost (Render already serves https + HSTS)
    },
  },
}));

// Rate limit the API: ~12 requests/second per IP is plenty for click-driven play.
app.use("/api", rateLimit({ windowMs: 10_000, max: 120, standardHeaders: true, legacyHeaders: false }));

app.use(express.json({ limit: "16kb" }));

// Kill switch: if HouseWatch has paused a game (integrity alert), refuse to open a
// new bet on it. The path is /api/<game>/bet or /api/<game>/start; in-progress
// rounds (cashout, reveal) are left alone so nobody is stranded mid-game.
app.use("/api", (req, res, next) => {
  const m = req.path.match(/^\/([a-z]+)\/(bet|start)$/);
  if (m && isGameBlocked(m[1])) {
    res.status(423).json({ error: `${m[1]} is paused for a fairness review. Try another game.` });
    return;
  }
  next();
});

// Force browsers to revalidate JS/HTML every load (they still get a fast 304 when
// unchanged) so a new deploy is picked up immediately, instead of an old build
// lingering in a stale cache.
const noCacheJs = (res: express.Response, path: string) => {
  if (path.endsWith(".js") || path.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
};
app.use(express.static(join(__dirname, "../../public"), { setHeaders: noCacheJs }));
app.use("/shared", express.static(join(__dirname, "../shared"), { setHeaders: noCacheJs }));

const stakeCents = (stake: unknown) => Math.round(Number(stake) * 100);
function requirePlayer(id: unknown) {
  const p = getPlayer(String(id));
  if (!p) throw new Error("Unknown player, start a session first");
  return p;
}
/** Defense-in-depth: a round can only be acted on by the player who owns it. */
function assertOwner(round: { playerId: string }, req: express.Request): void {
  if (round.playerId !== String(req.body?.playerId)) throw new Error("Not your round");
}
const wrap = (res: express.Response, fn: () => Promise<unknown>) =>
  fn().then((v) => res.json(v)).catch((e) => res.status(400).json({ error: (e as Error).message }));

// ---------- Session & fairness ----------
app.post("/api/session", (req, res) =>
  wrap(res, async () => {
    const s = await ensureSession(req.body?.playerId);
    noteContext(s.playerId, req.ip ?? "", String(req.body?.device ?? "")); // for HouseWatch, if configured
    return { ...s, recent: recentBets(s.playerId), activeMines: activeMinesFor(s.playerId) };
  }),
);
app.post("/api/rotate", (req, res) =>
  wrap(res, async () => {
    requirePlayer(req.body?.playerId);
    return rotateSeed(String(req.body.playerId), req.body?.clientSeed ? String(req.body.clientSeed) : undefined);
  }),
);

// ---------- Social: live win feed + leaderboards ----------
app.get("/api/feed", (req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders?.();
  for (const w of recentWins()) res.write(`data: ${JSON.stringify(w)}\n\n`);
  addFeedClient(res);
});
app.get("/api/leaderboard", (_req, res) => res.json(leaderboard()));
app.post("/api/topup", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    return { balance: topUp(p.id) };
  }),
);

// ---------- Instant games ----------
app.post("/api/dice/bet", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const target = Number(req.body?.target);
    const bet = stakeCents(req.body?.stake);
    if (!(target >= DICE_TARGET_MIN && target <= DICE_TARGET_MAX)) throw new Error(`Target ${DICE_TARGET_MIN}-${DICE_TARGET_MAX}`);
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

app.post("/api/slots/bet", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const bet = stakeCents(req.body?.stake);
    if (!(bet > 0)) throw new Error("Invalid stake");
    const reels = slotSpin(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const mult = slotPayout(reels);
    const payout = Math.floor(bet * mult);
    debitStake(p.id, p.nonce, bet);
    const balance = payout > 0 ? credit(p.id, payout) : getBalance(p.id);
    recordBet(p.id, "slots", p.nonce, `${reels.join("-")} → ${mult}×`, bet, payout, payout > 0, p.server_seed_hash, p.client_seed);
    return { game: "slots", reels, multiplier: mult, win: payout > 0, betCents: bet, payoutCents: payout, balance, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

// ---------- Crash (live, SSE-driven, server-authoritative) ----------
const floor2 = (n: number) => Math.floor(n * 100) / 100;
interface CrashRound {
  id: string; playerId: string; stakeCents: number; crashPoint: number; startedAt: number;
  cashed: boolean; ended: boolean; nonce: number; serverSeedHash: string; clientSeed: string;
  autoCashout?: number; // if set, the server cashes out automatically at this multiplier
  cashMult?: number; payoutCents?: number; // recorded when a win is settled
  lossTimer?: ReturnType<typeof setTimeout>; // deferred loss settlement (grace window)
}
// A cash-out sent just before the bust can arrive just after it (reaction + network
// lag). We don't finalize the loss until this grace passes, so such a cash-out
// still wins as long as the multiplier it locked in is below the bust point.
const CRASH_LOSS_GRACE_MS = 800;
const crashRounds = new Map<string, CrashRound>();
const crashActive = new Map<string, string>();

const crashHasBusted = (r: CrashRound) => crashMultiplierAt(Date.now() - r.startedAt) >= r.crashPoint;
/** Finalize a busted round exactly once (record the loss, free the player). */
function settleCrashLoss(r: CrashRound): void {
  if (r.ended || r.cashed) return;
  r.ended = true;
  if (r.lossTimer) { clearTimeout(r.lossTimer); r.lossTimer = undefined; }
  recordBet(r.playerId, "crash", r.nonce, `busted @${floor2(r.crashPoint)}×`, r.stakeCents, 0, false, r.serverSeedHash, r.clientSeed);
  crashActive.delete(r.playerId);
  setTimeout(() => crashRounds.delete(r.id), 30_000);
}
/** Mark a round busted but defer finalizing the loss, leaving a grace window in
 *  which a cash-out that was sent before the bust can still win. */
function scheduleCrashLoss(r: CrashRound): void {
  if (r.ended || r.cashed || r.lossTimer) return;
  r.lossTimer = setTimeout(() => settleCrashLoss(r), CRASH_LOSS_GRACE_MS);
}
/** Finalize a winning cash-out exactly once (credit the payout, free the player). */
function settleCrashWin(r: CrashRound, mult: number): { payoutCents: number; balance: number } {
  const payout = Math.floor(r.stakeCents * mult);
  if (r.ended) return { payoutCents: r.payoutCents ?? payout, balance: getBalance(r.playerId) };
  if (r.lossTimer) { clearTimeout(r.lossTimer); r.lossTimer = undefined; }
  r.cashed = true; r.ended = true; r.cashMult = mult; r.payoutCents = payout;
  const balance = credit(r.playerId, payout);
  recordBet(r.playerId, "crash", r.nonce, `cashed @${mult}×`, r.stakeCents, payout, true, r.serverSeedHash, r.clientSeed);
  crashActive.delete(r.playerId);
  setTimeout(() => crashRounds.delete(r.id), 30_000);
  return { payoutCents: payout, balance };
}
/** If an auto-cash-out target has been reached (and it's below the bust point),
 *  settle the win. Returns the win details, or null if nothing to do yet. */
function maybeAutoCashout(r: CrashRound): { multiplier: number; payoutCents: number; balance: number } | null {
  if (r.ended || r.autoCashout === undefined || r.autoCashout > r.crashPoint) return null;
  if (crashMultiplierAt(Date.now() - r.startedAt) < r.autoCashout) return null;
  const mult = r.autoCashout; // already normalized to 2 dp, pay exactly what the player set
  const w = settleCrashWin(r, mult);
  return { multiplier: mult, ...w };
}

app.post("/api/crash/start", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const bet = stakeCents(req.body?.stake);
    if (!(bet > 0)) throw new Error("Invalid stake");
    // Optional auto-cash-out target: the server settles the win at this multiplier
    // the instant it's reached, so a win never depends on tapping in time.
    let autoCashout: number | undefined = Number(req.body?.autoCashout);
    if (!Number.isFinite(autoCashout) || autoCashout < 1.01) autoCashout = undefined;
    else autoCashout = Math.round(Math.min(autoCashout, 1_000_000) * 100) / 100; // clean 2-dp target
    const prev = crashActive.get(p.id);
    if (prev) { crashRounds.delete(prev); crashActive.delete(p.id); }

    debitStake(p.id, p.nonce, bet);
    const crashPoint = limboResult(await betHmac(p.server_seed, p.client_seed, p.nonce)); // provably-fair bust point (hidden)
    const roundId = randomBytes(8).toString("hex");
    crashRounds.set(roundId, {
      id: roundId, playerId: p.id, stakeCents: bet, crashPoint, startedAt: Date.now(),
      cashed: false, ended: false, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed, autoCashout,
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
    const auto = maybeAutoCashout(r);
    if (auto) {
      send("cashout", auto);
      clearInterval(timer); res.end();
      return;
    }
    const m = crashMultiplierAt(Date.now() - r.startedAt);
    if (m >= r.crashPoint) {
      send("crash", { crashPoint: floor2(r.crashPoint) });
      clearInterval(timer); res.end();
      scheduleCrashLoss(r); // finalize the loss after the grace, unless a late cash-out wins first
    } else {
      send("tick", { multiplier: floor2(m) });
    }
  }, 100);
  req.on("close", () => clearInterval(timer));
});

// Poll fallback so a round always resolves even if the stream drops.
app.get("/api/crash/status", (req, res) => {
  const r = crashRounds.get(String(req.query.roundId));
  if (!r) { res.json({ ended: true, crashPoint: null }); return; }
  const auto = maybeAutoCashout(r); // settle an auto-cash-out even if the stream dropped
  if (auto) { res.json({ ended: true, cashed: true, ...auto }); return; }
  if (r.cashed) { res.json({ ended: true, cashed: true, multiplier: r.cashMult, payoutCents: r.payoutCents, balance: getBalance(r.playerId) }); return; }
  if (r.ended) { res.json({ ended: true, crashPoint: floor2(r.crashPoint) }); return; }
  if (crashHasBusted(r)) { scheduleCrashLoss(r); res.json({ ended: true, crashPoint: floor2(r.crashPoint) }); return; }
  res.json({ ended: false, multiplier: floor2(crashMultiplierAt(Date.now() - r.startedAt)) });
});

app.post("/api/crash/cashout", (req, res) =>
  wrap(res, async () => {
    const r = crashRounds.get(String(req.body?.roundId));
    if (!r) throw new Error("Round not found");
    assertOwner(r, req);
    if (r.cashed) throw new Error("Already cashed out");
    // Honor a reached auto-cash-out target first, so a tap that lands in the same
    // instant can never turn an auto-win into a reported loss.
    const auto = maybeAutoCashout(r);
    if (auto) return { multiplier: auto.multiplier, payoutCents: auto.payoutCents, balance: auto.balance };
    // Loss already finalized (grace elapsed): report the honest outcome, never a
    // phantom win. (Won't credit twice; won't claim a win we didn't pay.)
    if (r.ended) return { crashed: true, crashPoint: floor2(r.crashPoint) };

    // "What you see is what you get." The client sends the multiplier it was
    // displaying (`at`) when you tapped. We clamp it to what elapsed time allows
    // (you can never claim more than the server's own clock reached) so it's
    // provably fair and unspoofable. Then it's a win as long as that locked value
    // is below the hidden crash point, even if the request arrived a beat late.
    const serverMult = crashMultiplierAt(Date.now() - r.startedAt);
    const claimed = Number(req.body?.at);
    const at = Math.max(1, Math.min(Number.isFinite(claimed) ? claimed : serverMult, serverMult));
    if (at < r.crashPoint) {
      const mult = floor2(at);
      const w = settleCrashWin(r, mult);
      return { multiplier: mult, payoutCents: w.payoutCents, balance: w.balance };
    }
    settleCrashLoss(r);
    return { crashed: true, crashPoint: floor2(r.crashPoint) };
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
    if (spec.type === "straight" && !(Number.isInteger(spec.number) && spec.number >= 0 && spec.number <= 36)) throw new Error("Number 0-36");
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
    if (unique.length !== picks.length || picks.length < 1 || picks.length > KENO_MAX_PICKS) throw new Error(`Pick 1-${KENO_MAX_PICKS} numbers`);
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
    if (!(mines >= 1 && mines <= 24)) throw new Error("Mines must be 1-24");
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
    assertOwner(round, req);
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
    assertOwner(round, req);
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

// ---------- Dragon Tower (stateful climb) ----------
interface TowerRound {
  playerId: string; stakeCents: number; diff: string; tiles: number; traps: number; rows: number;
  layout: number[][]; level: number; nonce: number; serverSeedHash: string; clientSeed: string;
}
const towerRounds = new Map<string, TowerRound>();
const towerActive = new Map<string, string>();
function endTower(roundId: string, playerId: string): void { towerRounds.delete(roundId); towerActive.delete(playerId); }

app.post("/api/tower/start", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const diff = String(req.body?.difficulty);
    const d = TOWER_DIFF[diff];
    const bet = stakeCents(req.body?.stake);
    if (!d) throw new Error("Pick a difficulty");
    if (!(bet > 0)) throw new Error("Invalid stake");
    const prev = towerActive.get(p.id); // abandoning a climb forfeits its stake
    if (prev) { towerRounds.delete(prev); towerActive.delete(p.id); }
    debitStake(p.id, p.nonce, bet);
    const layout = await towerLayout(await betHmac(p.server_seed, p.client_seed, p.nonce), d.tiles, d.traps, TOWER_ROWS);
    const roundId = randomBytes(8).toString("hex");
    towerRounds.set(roundId, { playerId: p.id, stakeCents: bet, diff, tiles: d.tiles, traps: d.traps, rows: TOWER_ROWS, layout, level: 0, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed });
    towerActive.set(p.id, roundId);
    return {
      roundId, difficulty: diff, tiles: d.tiles, traps: d.traps, rows: TOWER_ROWS, betCents: bet, balance: getBalance(p.id),
      multipliers: Array.from({ length: TOWER_ROWS }, (_, i) => towerMultiplier(diff, i + 1)),
      nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed,
    };
  }),
);

app.post("/api/tower/pick", (req, res) =>
  wrap(res, async () => {
    const round = towerRounds.get(String(req.body?.roundId));
    if (!round) throw new Error("No such climb");
    assertOwner(round, req);
    const tile = Math.trunc(Number(req.body?.tile));
    if (!(tile >= 0 && tile < round.tiles)) throw new Error("Bad tile");
    const rowTraps = round.layout[round.level];

    if (rowTraps.includes(tile)) {
      recordBet(round.playerId, "tower", round.nonce, `${round.diff}, fell on row ${round.level + 1}`, round.stakeCents, 0, false, round.serverSeedHash, round.clientSeed);
      const layout = round.layout;
      endTower(String(req.body.roundId), round.playerId);
      return { trap: true, row: round.level, tile, betCents: round.stakeCents, win: false, layout, multiplier: 0, balance: getBalance(round.playerId) };
    }

    round.level += 1;
    const mult = towerMultiplier(round.diff, round.level);
    if (round.level === round.rows) {
      const payout = Math.floor(round.stakeCents * mult);
      const balance = credit(round.playerId, payout);
      recordBet(round.playerId, "tower", round.nonce, `${round.diff}, reached the top @${mult}×`, round.stakeCents, payout, true, round.serverSeedHash, round.clientSeed);
      const layout = round.layout;
      endTower(String(req.body.roundId), round.playerId);
      return { trap: false, row: round.level - 1, tile, rowTraps, cleared: true, level: round.level, multiplier: mult, betCents: round.stakeCents, win: payout > round.stakeCents, payoutCents: payout, balance, layout };
    }
    return { trap: false, row: round.level - 1, tile, rowTraps, level: round.level, multiplier: mult, nextMultiplier: towerMultiplier(round.diff, round.level + 1) };
  }),
);

app.post("/api/tower/cashout", (req, res) =>
  wrap(res, async () => {
    const round = towerRounds.get(String(req.body?.roundId));
    if (!round) throw new Error("No such climb");
    assertOwner(round, req);
    if (round.level < 1) throw new Error("Climb at least one row first");
    const mult = towerMultiplier(round.diff, round.level);
    const payout = Math.floor(round.stakeCents * mult);
    const balance = credit(round.playerId, payout);
    recordBet(round.playerId, "tower", round.nonce, `${round.diff}, cashed row ${round.level} @${mult}×`, round.stakeCents, payout, true, round.serverSeedHash, round.clientSeed);
    const layout = round.layout;
    endTower(String(req.body.roundId), round.playerId);
    return { payoutCents: payout, multiplier: mult, betCents: round.stakeCents, win: payout > round.stakeCents, balance, layout };
  }),
);

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
    assertOwner(r, req);
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

// ---------- Hi-Lo (server-authoritative card ladder) ----------
interface HiLoRound {
  id: string; playerId: string; stakeCents: number; deck: number[]; pos: number; multiplier: number;
  ended: boolean; nonce: number; serverSeedHash: string; clientSeed: string;
}
const hiloRounds = new Map<string, HiLoRound>();
const hiloActive = new Map<string, string>();
const hiloMults = (card: number) => ({ higher: hiloHigherMult(cardRank(card)), lower: hiloLowerMult(cardRank(card)) });

app.post("/api/hilo/start", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const bet = stakeCents(req.body?.stake);
    if (!(bet > 0)) throw new Error("Invalid stake");
    const prev = hiloActive.get(p.id);
    if (prev) { hiloRounds.delete(prev); hiloActive.delete(p.id); }

    debitStake(p.id, p.nonce, bet);
    const deck = await shuffledDeck(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const roundId = randomBytes(8).toString("hex");
    hiloRounds.set(roundId, { id: roundId, playerId: p.id, stakeCents: bet, deck, pos: 0, multiplier: 1, ended: false, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed });
    hiloActive.set(p.id, roundId);
    return { roundId, card: deck[0], ...hiloMults(deck[0]), multiplier: 1, betCents: bet, balance: getBalance(p.id), nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

app.post("/api/hilo/guess", (req, res) =>
  wrap(res, async () => {
    const r = hiloRounds.get(String(req.body?.roundId));
    if (!r || r.ended) throw new Error("Round is over");
    assertOwner(r, req);
    const choice = String(req.body?.choice);
    if (choice !== "higher" && choice !== "lower") throw new Error("Bad guess");
    if (r.pos + 1 >= 52) throw new Error("Deck exhausted, cash out");

    const cur = r.deck[r.pos];
    const next = r.deck[r.pos + 1];
    const m = hiloMults(cur);
    const correct = choice === "higher" ? cardRank(next) >= cardRank(cur) : cardRank(next) <= cardRank(cur);
    r.pos += 1;
    if (!correct) {
      r.ended = true;
      recordBet(r.playerId, "hilo", r.nonce, `busted at ${floor2(r.multiplier)}×`, r.stakeCents, 0, false, r.serverSeedHash, r.clientSeed);
      hiloActive.delete(r.playerId);
      return { card: next, correct: false, busted: true, balance: getBalance(r.playerId) };
    }
    r.multiplier *= choice === "higher" ? m.higher : m.lower;
    return { card: next, correct: true, multiplier: floor2(r.multiplier), ...hiloMults(next) };
  }),
);

app.post("/api/hilo/cashout", (req, res) =>
  wrap(res, async () => {
    const r = hiloRounds.get(String(req.body?.roundId));
    if (!r || r.ended) throw new Error("Round is over");
    assertOwner(r, req);
    r.ended = true;
    const mult = floor2(r.multiplier);
    const payout = Math.floor(r.stakeCents * mult);
    const balance = credit(r.playerId, payout);
    recordBet(r.playerId, "hilo", r.nonce, `cashed @${mult}×`, r.stakeCents, payout, payout > r.stakeCents, r.serverSeedHash, r.clientSeed);
    hiloActive.delete(r.playerId);
    return { multiplier: mult, payoutCents: payout, balance };
  }),
);

// ---------- Video Poker (Jacks or Better) ----------
interface VpRound { id: string; playerId: string; stakeCents: number; deck: number[]; hand: number[]; next: number; nonce: number; serverSeedHash: string; clientSeed: string; }
const vpRounds = new Map<string, VpRound>();
const vpActive = new Map<string, string>();

app.post("/api/vpoker/deal", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const bet = stakeCents(req.body?.stake);
    if (!(bet > 0)) throw new Error("Invalid stake");
    const prev = vpActive.get(p.id);
    if (prev) { vpRounds.delete(prev); vpActive.delete(p.id); }
    debitStake(p.id, p.nonce, bet);
    const deck = await shuffledDeck(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const roundId = randomBytes(8).toString("hex");
    vpRounds.set(roundId, { id: roundId, playerId: p.id, stakeCents: bet, deck, hand: deck.slice(0, 5), next: 5, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed });
    vpActive.set(p.id, roundId);
    return { roundId, hand: deck.slice(0, 5), betCents: bet, balance: getBalance(p.id), nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
  }),
);

app.post("/api/vpoker/draw", (req, res) =>
  wrap(res, async () => {
    const r = vpRounds.get(String(req.body?.roundId));
    if (!r) throw new Error("Round is over");
    assertOwner(r, req);
    const holds = Array.isArray(req.body?.holds) ? req.body.holds : [];
    for (let i = 0; i < 5; i++) if (!holds[i]) r.hand[i] = r.deck[r.next++];
    const evalResult = pokerEvaluate(r.hand);
    const payout = Math.floor(r.stakeCents * evalResult.multiplier);
    const balance = payout > 0 ? credit(r.playerId, payout) : getBalance(r.playerId);
    recordBet(r.playerId, "vpoker", r.nonce, `${evalResult.name} → ${evalResult.multiplier}×`, r.stakeCents, payout, payout > r.stakeCents, r.serverSeedHash, r.clientSeed);
    vpRounds.delete(r.id); vpActive.delete(r.playerId);
    return { hand: r.hand, name: evalResult.name, multiplier: evalResult.multiplier, betCents: r.stakeCents, payoutCents: payout, win: payout > 0, balance };
  }),
);

// ---------- Blackjack (hit / stand / double vs dealer) ----------
interface BjRound { id: string; playerId: string; stakeCents: number; deck: number[]; player: number[]; dealer: number[]; next: number; doubled: boolean; nonce: number; serverSeedHash: string; clientSeed: string; }
const bjRounds = new Map<string, BjRound>();
const bjActive = new Map<string, string>();

function bjResolve(r: BjRound) {
  const pv = handValue(r.player);
  if (pv <= 21) while (handValue(r.dealer) < 17) r.dealer.push(r.deck[r.next++]); // dealer stands on 17
  const dv = handValue(r.dealer);
  const wager = r.doubled ? r.stakeCents * 2 : r.stakeCents;
  let outcome: string, mult: number;
  if (pv > 21) { outcome = "Bust, dealer wins"; mult = 0; }
  else if (dv > 21) { outcome = "Dealer busts, you win"; mult = 2; }
  else if (pv > dv) { outcome = "You win"; mult = 2; }
  else if (pv < dv) { outcome = "Dealer wins"; mult = 0; }
  else { outcome = "Push"; mult = 1; }
  const payout = Math.floor(wager * mult);
  const balance = payout > 0 ? credit(r.playerId, payout) : getBalance(r.playerId);
  recordBet(r.playerId, "blackjack", r.nonce, outcome, wager, payout, payout > wager, r.serverSeedHash, r.clientSeed);
  bjRounds.delete(r.id); bjActive.delete(r.playerId);
  return { done: true, player: r.player, dealer: r.dealer, playerValue: pv, dealerValue: dv, outcome, payoutCents: payout, balance, betCents: wager };
}
const bjActiveRound = (req: express.Request) => {
  const r = bjRounds.get(String(req.body?.roundId));
  if (!r) throw new Error("Hand is over");
  assertOwner(r, req);
  return r;
};

app.post("/api/bj/deal", (req, res) =>
  wrap(res, async () => {
    const p = requirePlayer(req.body?.playerId);
    const bet = stakeCents(req.body?.stake);
    if (!(bet > 0)) throw new Error("Invalid stake");
    const prev = bjActive.get(p.id);
    if (prev) { bjRounds.delete(prev); bjActive.delete(p.id); }
    debitStake(p.id, p.nonce, bet);
    const deck = await shuffledDeck(await betHmac(p.server_seed, p.client_seed, p.nonce));
    const roundId = randomBytes(8).toString("hex");
    const player = [deck[0], deck[2]], dealer = [deck[1], deck[3]];
    const r: BjRound = { id: roundId, playerId: p.id, stakeCents: bet, deck, player, dealer, next: 4, doubled: false, nonce: p.nonce, serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed };
    const seed = { serverSeedHash: p.server_seed_hash, clientSeed: p.client_seed, nonce: p.nonce };

    if (isBlackjack(player) || isBlackjack(dealer)) {
      let outcome: string, payout: number;
      if (isBlackjack(player) && isBlackjack(dealer)) { outcome = "Push, both blackjack"; payout = bet; }
      else if (isBlackjack(player)) { outcome = "Blackjack! You win"; payout = Math.floor(bet * 2.5); }
      else { outcome = "Dealer blackjack"; payout = 0; }
      const balance = payout > 0 ? credit(p.id, payout) : getBalance(p.id);
      recordBet(p.id, "blackjack", p.nonce, outcome, bet, payout, payout > bet, p.server_seed_hash, p.client_seed);
      return { roundId, ...seed, done: true, player, dealer, playerValue: handValue(player), dealerValue: handValue(dealer), outcome, payoutCents: payout, balance, betCents: bet };
    }
    bjRounds.set(roundId, r); bjActive.set(p.id, roundId);
    return { roundId, ...seed, done: false, player, dealer: [dealer[0]], playerValue: handValue(player), canDouble: true, betCents: bet, balance: getBalance(p.id) };
  }),
);

app.post("/api/bj/hit", (req, res) =>
  wrap(res, async () => {
    const r = bjActiveRound(req);
    r.player.push(r.deck[r.next++]);
    // 21 or bust ends your turn automatically — you can't hit on 21.
    if (handValue(r.player) >= 21) return bjResolve(r);
    return { done: false, player: r.player, playerValue: handValue(r.player), canDouble: false };
  }),
);
app.post("/api/bj/stand", (req, res) => wrap(res, async () => bjResolve(bjActiveRound(req))));
app.post("/api/bj/double", (req, res) =>
  wrap(res, async () => {
    const r = bjActiveRound(req);
    if (r.player.length !== 2) throw new Error("Can only double on your first move");
    debitExtra(r.playerId, r.stakeCents);
    r.doubled = true;
    r.player.push(r.deck[r.next++]);
    return bjResolve(r);
  }),
);

const PORT = Number(process.env.PORT) || 3300;
app.listen(PORT, () => console.log(`FairHouse casino running at http://localhost:${PORT}`));
