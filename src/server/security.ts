/**
 * Optional bridge to HouseWatch, the fraud/abuse risk engine.
 *
 * When HOUSEWATCH_URL is set, every resolved bet is forwarded to HouseWatch's
 * /ingest endpoint so it can score accounts for multi-accounting, bots, impossible
 * win rates, and loss-chasing. It's fire-and-forget: if HouseWatch is down or the
 * env var is unset, gameplay is completely unaffected.
 */

// per-player context (IP + device fingerprint), captured at session time
const context = new Map<string, { ip: string; device: string }>();

// Kill switch: games HouseWatch has paused after an integrity alert. We poll for
// the list and refuse new bets on those games until they're cleared.
let blockedGames = new Set<string>();

export function isGameBlocked(game: string): boolean {
  return blockedGames.has(game);
}

function startBlockPoller(): void {
  const url = process.env.HOUSEWATCH_URL;
  if (!url) return;
  const poll = async () => {
    try {
      const r = await fetch(`${url}/blocked`);
      const d = (await r.json()) as { games?: string[] };
      blockedGames = new Set(d.games ?? []);
    } catch { /* keep the last known list if HouseWatch is unreachable */ }
  };
  poll();
  setInterval(poll, 5000);
}
startBlockPoller();

export function noteContext(playerId: string, ip: string, device: string): void {
  context.set(playerId, { ip: ip || "", device: device || "" });
}

export function emitBet(account: string, game: string, betCents: number, payoutCents: number): void {
  const url = process.env.HOUSEWATCH_URL;
  if (!url) return;
  const c = context.get(account) ?? { ip: "", device: "" };
  fetch(`${url}/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      account,
      game,
      stake_cents: betCents,
      payout_cents: payoutCents,
      ts: Date.now() / 1000,
      device: c.device,
      ip: c.ip,
    }),
  }).catch(() => { /* fire-and-forget: never let monitoring affect the game */ });
}
