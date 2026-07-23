# ♠ FairHouse — a provably-fair casino platform

A full casino website with **13 games on one shared wallet and one fairness
engine**. A lobby ties them together, and every outcome — in every game — is
cryptographically verifiable in the browser.

**Stack:** TypeScript · Node · Express (REST + Server-Sent Events) · SQLite (`better-sqlite3`) · Web Crypto · HTML5 SPA (vanilla, hash routing) — no frontend framework.

> Play money only — a fresh 1,000-credit wallet per browser.

---

## One fairness engine, every game

Every game derives its outcome from a single per-bet digest:

```
HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)
```

- the **serverSeed** is secret but committed as `SHA-256(serverSeed)` before you play,
- the **clientSeed** is yours (editable),
- the **nonce** advances once per bet — **shared across all 13 games**, exactly like a real casino account.

Each game maps that digest to its own result ([`src/shared/games.ts`](src/shared/games.ts)):

| Game | Kind | Mapping | Payout |
|---|---|---|---|
| **Dice** | instant | first 32 bits → roll `0–99.99`, win if under target | `100/target`, edged |
| **Coinflip** | instant | digest → heads / tails | `1.98×` |
| **Slots** | instant | three reels from the digest, three-of-a-kind pays | up to `70×` |
| **Plinko** | instant | one bit per row → 12-row path → bucket | `0.5×–15×` |
| **Roulette** | instant | European wheel `0–36` | straight `36×`, even-money `2×`, dozen `3×` |
| **Wheel** | instant | digest → one of 20 multiplier segments | up to `3.5×` |
| **Keno** | instant | 10 numbers drawn from a pool of 40 | paytable by spots × hits |
| **Crash** | live (SSE) | rising multiplier busts at a seed-derived point | your cash-out × |
| **Mines** | round | digest seeds a shuffled mine layout | grows per safe tile |
| **Memory** | round | digest shuffles a deck of pairs | fixed × on clearing in budget |
| **Hi-Lo** | round | digest shuffles a 52-card deck | compounds per correct guess |
| **Video Poker** | round | Jacks-or-Better on a seeded deck (9/6 paytable) | up to `800×` |
| **Blackjack** | round | hit / stand / double vs a dealer, on a seeded deck | `2×`, blackjack `3:2` |

Rotating the seed reveals the old `serverSeed` and commits to a fresh one, so you can
replay every past bet. The **Provably Fair** panel (top-right) verifies any bet right in
the browser, using the **same isomorphic module** the server computes with — see
[`src/shared/provablyFair.ts`](src/shared/provablyFair.ts). Every payout carries a 1% house edge.

The fairness and payout math is unit-tested (`npm test`): roll ranges and scaling,
seed reproducibility, house-edge multipliers, distribution checks, deterministic layouts
and deals, and the poker/blackjack hand evaluators.

## Money & state

- Balances are **integer cents**; every stake is debited and the nonce advanced in a
  single SQLite transaction under a **nonce guard**, so a bet can't be replayed or
  double-settled.
- **Instant games** resolve in one request. **Crash** streams its rising multiplier over
  Server-Sent Events and is server-authoritative on the bust point (with a polling
  fallback so a round always resolves even if the stream drops).
- **Stateful rounds** (Mines, Memory, Hi-Lo, Video Poker, Blackjack) fix the
  layout/deck from the seed at start — provably fair — then check each action against it
  until the player cashes out, busts, or the hand resolves. Payouts are credited on
  settlement.

## Architecture

```
Browser SPA (hash router)               Express server
  app.js — session, wallet, router,     ┌ index.ts   session, rotate, /api/<game>/*, SSE
           provably-fair verifier       ├ ledger.ts  shared wallet + seed state (SQLite)
  games/*.js — one module per game      └ shared/{provablyFair,games}.ts  outcomes
  imports the SAME shared module  ◄─────  (imported by both server and browser)
```

## Run it

```bash
npm install
npm test      # fairness + game-math unit tests
npm start     # http://localhost:3300
```

## Roadmap

- Pre-committed seed **chain** (commit to all future server seeds up front).
- Accounts & auth (currently a per-browser guest wallet).
- Persisted leaderboards and per-game statistics.

---

Built by **Akam Nabard Mohammed** — [Akamnabard11@gmail.com](mailto:Akamnabard11@gmail.com)
