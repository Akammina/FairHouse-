# ♠ FairHouse

A provably-fair casino with 13 games on one shared wallet and a single fairness
engine. Every outcome can be verified in the browser.

Play money only; each browser starts with a 1,000-credit wallet.

Stack: TypeScript, Node, Express (REST + Server-Sent Events), SQLite
(better-sqlite3), Web Crypto. The frontend is a vanilla HTML/JS single-page app
with hash routing and no framework.

## Fairness

Each bet's outcome comes from one digest:

```
HMAC-SHA256(serverSeed, `${clientSeed}:${nonce}`)
```

- `serverSeed` is secret, but its SHA-256 hash is published before you play.
- `clientSeed` is yours and can be edited.
- `nonce` increases by one on every bet and is shared across all games.

Each game turns that digest into a result. The mappings are in
[`src/shared/games.ts`](src/shared/games.ts):

| Game | Kind | Mapping | Payout |
|---|---|---|---|
| Dice | instant | first 32 bits → roll `0-99.99`, win under target | `100/target`, edged |
| Coinflip | instant | digest → heads / tails | `1.98×` |
| Slots | instant | three reels from the digest, three-of-a-kind pays | up to `70×` |
| Plinko | instant | one bit per row → 12-row path → bucket | `0.5×-15×` |
| Roulette | instant | European wheel `0-36` | straight `36×`, even-money `2×`, dozen `3×` |
| Wheel | instant | digest → one of 20 segments | up to `3.5×` |
| Keno | instant | 10 drawn from a pool of 40 | paytable by spots × hits |
| Crash | live (SSE) | rising multiplier busts at a seed-derived point | your cash-out × |
| Mines | round | digest seeds the mine layout | grows per safe tile |
| Memory | round | digest shuffles a deck of pairs | fixed × on clearing in budget |
| Hi-Lo | round | digest shuffles a 52-card deck | compounds per correct guess |
| Video Poker | round | Jacks-or-Better on a seeded deck (9/6) | up to `800×` |
| Blackjack | round | hit / stand / double vs the dealer, seeded deck | `2×`, blackjack `3:2` |

Rotating the seed reveals the previous `serverSeed` and commits a new one, so any
past bet can be replayed and checked. The Provably Fair panel does this in the
browser with the same module the server runs
([`src/shared/provablyFair.ts`](src/shared/provablyFair.ts)). Every payout carries
a 1% house edge.

The outcome and payout math is covered by unit tests (`npm test`): roll ranges,
seed reproducibility, house-edge multipliers, distribution, the deterministic
deck and layout generation, and the poker and blackjack evaluators.

## Money and state

Balances are stored as integer cents. Each stake is debited and the nonce
advanced in one SQLite transaction guarded by the nonce, so a bet can't be
replayed or settled twice.

Instant games resolve in a single request. Crash streams its multiplier over
Server-Sent Events and decides the bust point server-side, with a polling
fallback so a round still resolves if the stream drops. The stateful games
(Mines, Memory, Hi-Lo, Video Poker, Blackjack) fix their deck or layout from the
seed when the round starts, then check each move against it until the round ends.

## Layout

```
src/
  server/
    index.ts    routes: session, seed rotation, /api/<game>/*, crash SSE
    ledger.ts   wallet and seed state (SQLite)
  shared/
    provablyFair.ts   hash/HMAC helpers, shared with the browser
    games.ts          per-game outcome math
public/         SPA: app.js plus one module per game under games/
```

## Running locally

```bash
npm install
npm run build
npm start        # http://localhost:3300
npm test         # unit tests
```

## Game Math & Fairness Lab (Python)

[`math-lab/`](math-lab/) is a Python companion that ports this casino's exact
game math and (1) independently **verifies** any bet's provably-fair outcome and
(2) **Monte-Carlo simulates** every game to measure its true RTP and house edge.
The Python is checked against the real TypeScript byte-for-byte by a parity
suite. See [math-lab/README.md](math-lab/README.md).

## Possible next steps

- Commit to a chain of future server seeds up front.
- Real accounts instead of a per-browser wallet.
- Leaderboards and per-game stats.
