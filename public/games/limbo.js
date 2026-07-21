import { HOUSE_EDGE } from "/shared/provablyFair.js";
import { shell, renderRecent, pushRecent, stakeField, wireStake } from "./common.js";

export function renderLimbo(root, ctx) {
  shell(root, {
    title: "Limbo", icon: "🚀", accent: "var(--limbo)",
    stage: `
      <div class="limbo-stage">
        <div class="limbo-strip" id="lstrip"></div>
        <div class="limbo-display" id="ldisp">1.00×</div>
        <div class="limbo-sub" id="lsub">Beat 2.00× to win</div>
      </div>
      <div class="stat-row" style="margin:20px 0 18px">
        <div class="stat"><span class="l">Target ×</span><span class="v" id="ltargetv">2.00×</span></div>
        <div class="stat"><span class="l">Win chance</span><span class="v" id="lchance">49.50%</span></div>
        <div class="stat"><span class="l">Payout</span><span class="v" id="lpayout">20.00</span></div>
      </div>
      <div class="fld"><span>Target multiplier</span>
        <input id="ltarget" class="input" type="number" min="1.01" max="1000" step="0.01" value="2.00" /></div>
      <div style="margin-top:14px">${stakeField("lstake")}</div>
      <button id="lbet" class="btn" style="margin-top:14px">Bet</button>
      <p class="msg" id="lmsg" style="margin-top:10px"></p>`,
  });
  renderRecent(ctx, "limbo");
  wireStake("lstake");

  const $ = (id) => document.getElementById(id);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const target = () => Number($("ltarget").value);
  const stake = () => Number($("lstake").value) || 0;

  // Seed the results strip from history (parse the stored detail "… → X×").
  ctx.state.recent.filter((b) => b.game === "limbo").slice(0, 15).reverse().forEach((b) => {
    const m = /→\s*([\d.]+)×/.exec(b.detail);
    if (m) addPill(Number(m[1]), b.win === 1 || b.win === true);
  });

  function sync() {
    const t = target();
    $("ltargetv").textContent = t.toFixed(2) + "×";
    $("lchance").textContent = t >= 1.01 ? ((100 * (1 - HOUSE_EDGE)) / t).toFixed(2) + "%" : "—";
    $("lpayout").textContent = (stake() * t).toFixed(2);
    if (!$("ldisp").classList.contains("rolling")) {
      $("lsub").textContent = `Beat ${t.toFixed(2)}× to win`;
      $("lsub").className = "limbo-sub";
    }
  }
  $("ltarget").addEventListener("input", sync);
  $("lstake").addEventListener("input", sync);
  sync();

  function addPill(value, win) {
    const strip = $("lstrip");
    const pill = document.createElement("span");
    pill.className = "limbo-pill " + (win ? "win" : "lose");
    pill.textContent = value.toFixed(2) + "×";
    strip.prepend(pill);
    while (strip.children.length > 15) strip.lastChild.remove();
  }

  function animate(result, tgt, win, onDone) {
    const disp = $("ldisp");
    if (reduce) { disp.textContent = result.toFixed(2) + "×"; disp.className = "limbo-display " + (win ? "win" : "lose"); onDone(); return; }
    disp.className = "limbo-display rolling";
    const dur = 850, start = performance.now();
    function frame(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = 1 + (result - 1) * eased;
      disp.textContent = val.toFixed(2) + "×";
      if (win && val >= tgt) disp.classList.add("win"); // flip green the moment it clears the target
      if (p < 1) requestAnimationFrame(frame);
      else { disp.className = "limbo-display " + (win ? "win" : "lose"); disp.textContent = result.toFixed(2) + "×"; onDone(); }
    }
    requestAnimationFrame(frame);
  }

  $("lbet").addEventListener("click", async () => {
    $("lbet").disabled = true;
    $("lmsg").textContent = "";
    try {
      const res = await ctx.api("/api/limbo/bet", { stake: stake(), target: target() });
      $("lsub").textContent = "Rolling…"; $("lsub").className = "limbo-sub";
      animate(res.result, res.target, res.win, () => {
        $("lsub").textContent = res.win
          ? `Rolled ${res.result.toFixed(2)}× — beat ${res.target.toFixed(2)}× · +${ctx.money(res.payoutCents - res.betCents)}`
          : `Rolled ${res.result.toFixed(2)}× — needed ${res.target.toFixed(2)}×`;
        $("lsub").className = "limbo-sub " + (res.win ? "win" : "lose");
        addPill(res.result, res.win);
        ctx.applyResult(res);
        pushRecent(ctx, "limbo", `@${res.target}× → ${res.result.toFixed(2)}×`, res.betCents, res.payoutCents, res.win);
        $("lbet").disabled = false;
      });
    } catch (e) {
      $("lmsg").textContent = e.message; $("lmsg").className = "msg lose";
      $("lbet").disabled = false;
    }
  });
}
