import { shell, renderRecent, pushRecent, stakeField, wireStake, cardHTML } from "./common.js";
import { burst } from "../confetti.js";

const ACCENT = "#2fae66";

export function renderBlackjack(root, ctx) {
  shell(root, {
    title: "Blackjack", iconKey: "blackjack", accent: ACCENT,
    stage: `
      <div class="bj-area">
        <div class="bj-side"><span class="bj-label">Dealer <b id="bjDealerVal"></b></span><div class="bj-row" id="bjDealer"></div></div>
        <div class="bj-side"><span class="bj-label">You <b id="bjPlayerVal"></b></span><div class="bj-row" id="bjPlayer"></div></div>
      </div>
      <p class="msg" id="bjMsg" style="margin:14px 0">Blackjack pays 3:2. Dealer stands on 17.</p>
      <div id="bjActions" hidden>
        <div class="bj-btns">
          <button class="btn bj-hit" id="bjHit">Hit</button>
          <button class="btn bj-stand" id="bjStand">Stand</button>
          <button class="btn bj-double" id="bjDouble">Double</button>
        </div>
      </div>
      <div id="bjSetup">
        ${stakeField("bjStake")}
        <button id="bjDeal" class="btn" style="margin-top:14px;--accent:${ACCENT}">Deal</button>
      </div>`,
  });
  renderRecent(ctx, "blackjack");
  wireStake("bjStake");

  const $ = (id) => document.getElementById(id);
  let round = null, busy = false;

  const setPlaying = (on) => { $("bjActions").hidden = !on; $("bjSetup").hidden = on; };
  const row = (el, cards, hideLast) => { el.innerHTML = cards.map((c) => cardHTML(c, "dealing")).join("") + (hideLast ? cardHTML(37, "back dealing") : ""); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Client-side hand value (mirrors the server) so we can show the dealer's total
  // rising as each card turns over.
  const handValue = (cards) => {
    let total = 0, aces = 0;
    for (const c of cards) { const r = c % 13; total += r <= 8 ? r + 2 : r === 12 ? 11 : 10; if (r === 12) aces++; }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
  };

  // Play out the dealer: flip the hole card, then draw one card at a time.
  async function revealDealer(full) {
    const el = $("bjDealer");
    el.innerHTML = full.slice(0, 2).map((c) => cardHTML(c, "dealing")).join(""); // hole card flips up
    $("bjDealerVal").textContent = handValue(full.slice(0, 2));
    ctx.sound.reveal();
    await wait(750);
    for (let n = 2; n < full.length; n++) {
      el.insertAdjacentHTML("beforeend", cardHTML(full[n], "dealing"));
      $("bjDealerVal").textContent = handValue(full.slice(0, n + 1));
      ctx.sound.reveal();
      await wait(750);
    }
  }

  function showPlayer(cards, val) { row($("bjPlayer"), cards, false); $("bjPlayerVal").textContent = val; }
  function showDealer(cards, val, hideHole) { row($("bjDealer"), cards, hideHole); $("bjDealerVal").textContent = hideHole ? "" : val; }

  async function act(path, extra) {
    if (busy) return; busy = true;
    document.querySelectorAll("#bjActions button").forEach((b) => (b.disabled = true));
    try {
      const res = await ctx.api(path, { roundId: round.roundId, ...extra });
      ctx.sound.reveal();
      if (res.player) showPlayer(res.player, res.playerValue);
      if (res.done) await finish(res); // finish() plays out the dealer card by card
      else $("bjDouble").style.display = res.canDouble ? "" : "none";
    } catch (e) { $("bjMsg").textContent = e.message; $("bjMsg").className = "msg lose"; }
    finally { busy = false; document.querySelectorAll("#bjActions button").forEach((b) => (b.disabled = false)); }
  }

  $("bjDeal").addEventListener("click", async () => {
    $("bjDeal").disabled = true;
    try {
      const res = await ctx.api("/api/bj/deal", { stake: Number($("bjStake").value) });
      round = { roundId: res.roundId, stakeCents: res.betCents, nonce: res.nonce, serverSeedHash: res.serverSeedHash, clientSeed: res.clientSeed };
      ctx.applyResult(res); ctx.sound.reveal();
      showPlayer(res.player, res.playerValue);
      showDealer(res.done ? [res.dealer[0]] : res.dealer, res.dealerValue, true); // hole card hidden until reveal
      if (res.done) { await finish(res); }
      else { setPlaying(true); $("bjDouble").style.display = res.canDouble ? "" : "none"; $("bjMsg").textContent = "Hit, stand, or double."; $("bjMsg").className = "msg"; }
    } catch (e) { $("bjMsg").textContent = e.message; $("bjMsg").className = "msg lose"; }
    finally { $("bjDeal").disabled = false; }
  });

  $("bjHit").addEventListener("click", () => act("/api/bj/hit"));
  $("bjStand").addEventListener("click", () => act("/api/bj/stand"));
  $("bjDouble").addEventListener("click", () => act("/api/bj/double"));

  async function finish(res) {
    $("bjActions").hidden = true;        // dealer is playing — no player actions
    await revealDealer(res.dealer);      // flip hole card, then draw card by card
    const win = res.payoutCents > res.betCents;
    const push = res.payoutCents === res.betCents;
    $("bjMsg").textContent = win ? `${res.outcome} — +${ctx.money(res.payoutCents - res.betCents)}` : res.outcome;
    $("bjMsg").className = "msg " + (win ? "win" : push ? "" : "lose");
    if (win) { ctx.sound.win(); const r = $("bjPlayer").getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, 1.3); }
    else if (!push) ctx.sound.lose();
    ctx.applyResult(res);
    pushRecent(ctx, "blackjack", res.outcome, res.betCents, res.payoutCents, win, round.nonce, round.serverSeedHash, round.clientSeed);
    round = null;
    setPlaying(false);
  }

  setPlaying(false);
}
