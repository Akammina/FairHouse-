/**
 * Shared wallet + per-player fairness state for the whole casino.
 *
 * One balance and one seed triplet (serverSeed / clientSeed / nonce) are shared
 * across every game — the nonce advances once per resolved bet regardless of
 * which game it was. Money is integer cents; each settlement is a single SQLite
 * transaction guarded by the nonce so a bet can't be replayed or double-paid.
 */
import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sha256Hex } from "../shared/provablyFair.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, "../../fairhouse.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id               TEXT PRIMARY KEY,
    balance          INTEGER NOT NULL,
    server_seed      TEXT NOT NULL,
    server_seed_hash TEXT NOT NULL,
    client_seed      TEXT NOT NULL,
    nonce            INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bets (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id        TEXT NOT NULL,
    game             TEXT NOT NULL,
    nonce            INTEGER NOT NULL,
    detail           TEXT NOT NULL,        -- short human summary, e.g. "under 50 → 42.10"
    bet_cents        INTEGER NOT NULL,
    payout_cents     INTEGER NOT NULL,
    win              INTEGER NOT NULL,
    server_seed_hash TEXT NOT NULL DEFAULT '',  -- which committed seed this bet used
    client_seed      TEXT NOT NULL DEFAULT '',  -- and the client seed at the time
    created_at       INTEGER NOT NULL
  );
`);

const STARTING_BALANCE = 100_000; // 1000.00 credits

export interface PlayerRow {
  id: string;
  balance: number;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  nonce: number;
}
const selectPlayer = db.prepare<[string], PlayerRow>("SELECT * FROM players WHERE id = ?");
const insertPlayer = db.prepare(
  `INSERT INTO players (id, balance, server_seed, server_seed_hash, client_seed, nonce, created_at)
   VALUES (?, ?, ?, ?, ?, 0, ?)`,
);

export function sessionState(p: PlayerRow) {
  return {
    playerId: p.id,
    balance: p.balance,
    serverSeedHash: p.server_seed_hash,
    clientSeed: p.client_seed,
    nonce: p.nonce,
  };
}

export async function ensureSession(playerId?: string) {
  if (playerId) {
    const existing = selectPlayer.get(playerId);
    if (existing) return sessionState(existing);
  }
  const id = playerId && /^[\w-]{8,64}$/.test(playerId) ? playerId : randomBytes(12).toString("hex");
  const serverSeed = randomBytes(32).toString("hex");
  const hash = await sha256Hex(serverSeed);
  insertPlayer.run(id, STARTING_BALANCE, serverSeed, hash, randomBytes(8).toString("hex"), Date.now());
  return sessionState(selectPlayer.get(id)!);
}

export function getPlayer(playerId: string): PlayerRow | undefined {
  return selectPlayer.get(playerId);
}
export function getBalance(playerId: string): number {
  return selectPlayer.get(playerId)?.balance ?? 0;
}

const bumpNonceStake = db.prepare(
  "UPDATE players SET balance = balance - ?, nonce = nonce + 1 WHERE id = ? AND nonce = ?",
);
const adjustBalance = db.prepare("UPDATE players SET balance = balance + ? WHERE id = ?");
const insertBet = db.prepare(
  `INSERT INTO bets (player_id, game, nonce, detail, bet_cents, payout_cents, win, server_seed_hash, client_seed, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

/**
 * Debit a stake and advance the nonce atomically, under a nonce guard. Used by
 * instant games (payout credited in the same call) and by mines round starts
 * (payout 0 up front, credited later on cashout).
 */
export const debitStake = db.transaction(
  (playerId: string, expectedNonce: number, betCents: number): void => {
    const p = selectPlayer.get(playerId);
    if (!p) throw new Error("Unknown player");
    if (p.nonce !== expectedNonce) throw new Error("Nonce moved — retry");
    if (p.balance < betCents) throw new Error("Insufficient funds");
    bumpNonceStake.run(betCents, playerId, expectedNonce);
  },
);

export function credit(playerId: string, amountCents: number): number {
  if (amountCents > 0) adjustBalance.run(amountCents, playerId);
  return getBalance(playerId);
}

export function recordBet(
  playerId: string,
  game: string,
  nonce: number,
  detail: string,
  betCents: number,
  payoutCents: number,
  win: boolean,
  serverSeedHash: string,
  clientSeed: string,
): void {
  insertBet.run(playerId, game, nonce, detail, betCents, payoutCents, win ? 1 : 0, serverSeedHash, clientSeed, Date.now());
}

export async function rotateSeed(playerId: string, newClientSeed?: string) {
  const p = selectPlayer.get(playerId);
  if (!p) throw new Error("Unknown player");
  const revealedServerSeed = p.server_seed;
  const revealedHash = p.server_seed_hash;
  const nextServerSeed = randomBytes(32).toString("hex");
  const nextHash = await sha256Hex(nextServerSeed);
  const clientSeed = newClientSeed && newClientSeed.length >= 1 && newClientSeed.length <= 64 ? newClientSeed : p.client_seed;
  db.prepare(
    "UPDATE players SET server_seed = ?, server_seed_hash = ?, client_seed = ?, nonce = 0 WHERE id = ?",
  ).run(nextServerSeed, nextHash, clientSeed, playerId);
  return { revealedServerSeed, revealedHash, ...sessionState(selectPlayer.get(playerId)!) };
}

export function recentBets(playerId: string, limit = 20) {
  return db
    .prepare(
      `SELECT game, nonce, detail, bet_cents, payout_cents, win, server_seed_hash, client_seed
       FROM bets WHERE player_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(playerId, limit);
}
