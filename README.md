# ♠ FairHouse — a provably-fair casino platform

A full casino website with **four games on one shared wallet and one fairness
engine**: Dice, Coinflip, Limbo, and Mines. A lobby ties them together, and
every outcome — in every game — is cryptographically verifiable in the browser.

**Stack:** TypeScript · Node · Express (REST) · SQLite (`better-sqlite3`) · Web Crypto · HTML5 SPA (vanilla, hash routing) — no frontend framework.

> Play money only — a fresh 1,000-credit wallet per browser.

---

## One fairness engine, every game

All four games derive their outcome from a single per-bet digest:

```
HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)
```

- the **serverSeed** is secret but committed as `SHA-256(serverSeed)` before you play,
- the **clientSeed** is yours (editable),
- the **nonce** advances once per bet — **shared across all four games**, exactly like a real casino account.

Each game maps that digest to its own result ([`src/shared/games.ts`](src/shared/games.ts)):

| Game | Mapping | Payout |
|---|---|---|
| **Dice** | first 32 bits → roll `0–99.99`, win if under target | `100/target`, edged |
| **Coinflip** | digest → heads/tails | `1.98×` |
| **Limbo** | `(1−edge)/(1−X)` → a random multiplier | your target × |
| **Mines** | digest seeds a shuffled mine layout | grows per safe tile |

Rotating the seed reveals the old `serverSeed` and commits to a fresh one, so you can
replay every past bet. The **Provably Fair** panel (top-right) verifies any bet right in
the browser, using the **same isomorphic module** the server computes with — see
[`src/shared/provablyFair.ts`](src/shared/provablyFair.ts). Every payout carries a 1% edge.

The fairness and payout math is unit-tested (`npm test`): roll ranges and scaling,
seed reproducibility, house-edge multipliers, distribution checks, and the mines layout
and multiplier curve.

## Money & state

- Balances are **integer cents**; every stake is debited and the nonce advanced in a
  single SQLite transaction under a **nonce guard**, so a bet can't be replayed or
  double-settled.
- **Mines** is a stateful round: the layout is fixed from the seed at start (provably
  fair), then each reveal checks against it until you cash out or hit a mine — payouts
  credited on cashout.

## Architecture

```
Browser SPA (hash router)              Express server
  app.js — session, wallet, router     ┌ index.ts   session, rotate, /api/<game>/*
  games/{dice,coinflip,limbo,mines}.js ├ ledger.ts  shared wallet + seed state (SQLite)
  imports the SAME shared module  ◄──  └ shared/{provablyFair,games}.ts  outcomes
```

## Run it

```bash
npm install
npm test      # fairness + game-math unit tests
npm start     # http://localhost:3300
```

## Roadmap

- Add the real-time **Crash** game (WebSocket) into the hub.
- Pre-committed seed **chain** (commit to all future server seeds up front).
- Accounts & auth (currently a per-browser guest wallet).

---

Built by **Akam Nabard Mohammed** — [Akamnabard11@gmail.com](mailto:Akamnabard11@gmail.com)
