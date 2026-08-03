import { shell, renderRecent, pushRecent, stakeField, wireStake, cardHTML } from "./common.js";
import { burst } from "../confetti.js";

const ACCENT = "#4fd1c5";

export function renderHilo(root, ctx) {
  shell(root, {
    title: "Hi-Lo", iconKey: "hilo", accent: ACCENT,
    stage: `
      <div class="hilo-board">
        <div class="hilo-trail" id="hiloTrail"></div>
        <div class="hilo-current" id="hiloCard">${cardHTML(51)}</div>
      </div>
      <p class="msg" id="hiloMsg" style="margin:14px 0">Guess whether the next card is higher or lower.</p>
      <div class="stat-row" style="margin-bottom:14px">
        <div class="stat"><span class="l">Multiplier</span><span class="v" id="hiloMult">1.00×</span></div>
        <div class="stat"><span class="l">Cash value</span><span class="v" id="hiloWin">—</span></div>
      </div>
      <div id="hiloPlay" hidden>
        <div class="hilo-guesses">
          <button class="btn hilo-hi" id="hiloHigher">Higher ▲</button>
          <button class="btn hilo-lo" id="hiloLower">Lower ▼</button>
        </div>
        <button class="btn cashout" id="hiloCash" style="margin-top:10px">Cash out</button>
      </div>
      <div id="hiloSetup">
        ${stakeField("hiloStake")}
        <button id="hiloDeal" class="btn" style="margin-top:14px;--accent:${ACCENT}">Deal card</button>
      </div>`,
  });
  renderRecent(ctx, "hilo");
  wireStake("hiloStake");

  const $ = (id) => document.getElementById(id);
  let round = null, lock = false;

  const setPlaying = (on) => { $("hiloPlay").hidden = !on; $("hiloSetup").hidden = on; };
  function showCard(c, animate) { $("hiloCard").innerHTML = cardHTML(c, animate ? "dealing" : ""); ctx.sound.reveal(); }
  function pushTrail(c) {
    const t = $("hiloTrail");
    t.insertAdjacentHTML("beforeend", cardHTML(c));
    while (t.children.length > 8) t.firstChild.remove();
  }
  function setMults(higher, lower) {
    $("hiloHigher").textContent = `Higher ▲ ${higher}×`;
    $("hiloLower").textContent = `Lower ▼ ${lower}×`;
  }
  function setLadder(mult) {
    $("hiloMult").textContent = mult.toFixed(2) + "×";
    $("hiloWin").textContent = ctx.money(Math.floor(round.stakeCents * mult));
  }

  $("hiloDeal").addEventListener("click", async () => {
    $("hiloDeal").disabled = true;
    try {
      const res = await ctx.api("/api/hilo/start", { stake: Number($("hiloStake").value) });
      round = { roundId: res.roundId, stakeCents: res.betCents, mult: 1, card: res.card, nonce: res.nonce, serverSeedHash: res.serverSeedHash, clientSeed: res.clientSeed };
      ctx.applyResult(res);
      $("hiloTrail").innerHTML = "";
      showCard(res.card, true);
      setMults(res.higher, res.lower);
      setLadder(1);
      $("hiloMsg").textContent = "Higher or lower?"; $("hiloMsg").className = "msg";
      setPlaying(true);
    } catch (e) { $("hiloMsg").textContent = e.message; $("hiloMsg").className = "msg lose"; }
    finally { $("hiloDeal").disabled = false; }
  });

  async function guess(choice) {
    if (!round || lock) return;
    lock = true;
    try {
      const res = await ctx.api("/api/hilo/guess", { roundId: round.roundId, choice });
      pushTrail(round.card);
      round.card = res.card;
      showCard(res.card, true);
      if (res.correct) {
        round.mult = res.multiplier;
        setLadder(res.multiplier); setMults(res.higher, res.lower);
        ctx.sound.cashout();
        $("hiloMsg").textContent = "Correct! Keep going or cash out."; $("hiloMsg").className = "msg win";
      } else {
        ctx.sound.lose();
        $("hiloMsg").textContent = `Wrong — lost ${ctx.money(round.stakeCents)}`; $("hiloMsg").className = "msg lose";
        ctx.applyResult(res);
        pushRecent(ctx, "hilo", `busted at ${round.mult.toFixed(2)}×`, round.stakeCents, 0, false, round.nonce, round.serverSeedHash, round.clientSeed);
        endRound();
      }
    } catch (e) { $("hiloMsg").textContent = e.message; $("hiloMsg").className = "msg lose"; }
    finally { lock = false; }
  }
  $("hiloHigher").addEventListener("click", () => guess("higher"));
  $("hiloLower").addEventListener("click", () => guess("lower"));

  $("hiloCash").addEventListener("click", async () => {
    if (!round || lock) return;
    lock = true; $("hiloCash").disabled = true;
    try {
      const res = await ctx.api("/api/hilo/cashout", { roundId: round.roundId });
      ctx.sound.win(); ctx.applyResult(res);
      const won = res.payoutCents - round.stakeCents;
      $("hiloMsg").textContent = won >= 0 ? `Cashed @ ${res.multiplier.toFixed(2)}× — ${won > 0 ? "won +" + ctx.money(won) : "broke even"}` : "";
      $("hiloMsg").className = "msg win";
      if (won > 0) { const r = $("hiloCard").getBoundingClientRect(); burst(r.left + r.width / 2, r.top + r.height / 2, 1.2); }
      pushRecent(ctx, "hilo", `cashed @${res.multiplier.toFixed(2)}×`, round.stakeCents, res.payoutCents, won > 0, round.nonce, round.serverSeedHash, round.clientSeed);
      endRound();
    } catch (e) { $("hiloMsg").textContent = e.message; $("hiloMsg").className = "msg lose"; }
    finally { lock = false; $("hiloCash").disabled = false; }
  });

  function endRound() {
    round = null;
    setTimeout(() => setPlaying(false), 1400);
  }

  setPlaying(false);
}
