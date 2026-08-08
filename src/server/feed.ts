// Live "Big Wins" feed. Any winning bet is pushed to every connected client over
// Server-Sent Events, the scrolling win ticker every real operator has. In-memory
// only; nothing to persist.
import type { Response } from "express";

export interface WinEvent {
  alias: string;
  game: string;
  netCents: number;   // amount won above the stake
  mult: number;       // payout / stake
  ts: number;
}

const clients = new Set<Response>();

export function addFeedClient(res: Response): void {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

export function broadcastWin(win: WinEvent): void {
  const line = `data: ${JSON.stringify(win)}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { clients.delete(res); }
  }
}
