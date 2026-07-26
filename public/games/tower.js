import { shell, renderRecent, pushRecent, stakeField, wireStake, money } from "./common.js";
import { burst } from "../confetti.js";

const ACCENT = "#a855f7";
const DIFFS = [
  { key: "easy", label: "Easy", sub: "3 of 4 safe" },
  { key: "medium", label: "Medium", sub: "2 of 3 safe" },
  { key: "hard", label: "Hard", sub: "1 of 2 safe" },
  { key: "expert", label: "Expert", sub: "1 of 3 safe" },
];

export function renderTower(root, ctx) {
  shell(root, {
    title: "Dragon Tower", icon: "🐉", accent: ACCENT,
    stage: `
      <div class="tw-diffs" id="twDiffs">
        ${DIFFS.map((d) => `<button class="tw-diff ${d.key === "medium" ? "sel" : ""}" data-diff="${d.key}"><b>${d.label}</b><span>${d.sub}</span></button>`).join("")}
      </div>
      <div class="tower" id="tower"></div>
      <p class="msg" id="twMsg" style="margin:12px 0">Climb the tower — one tile per row hides a 💀. Cash out any time.</p>
      ${stakeField("twStake")}
      <div class="tw-actions">
        <button id="twStart" class="btn" style="--accent:${ACCENT}">Start climb</button>
        <button id="twCash" class="btn cashout" style="--accent:${ACCENT};display:none">Cash out</button>
      </div>`,
  });
  renderRecent(ctx, "tower");
  wireStake("twStake");

  const $ = (id) => document.getElementById(id);
  let diff = "medium";
  let round = null;

  $("twDiffs").querySelectorAll(".tw-diff").forEach((b) =>
    b.addEventListener("click", () => {
      if (round) return;
      diff = b.dataset.diff;
      $("twDiffs").querySelectorAll(".tw-diff").forEach((x) => x.classList.toggle("sel", x === b));
    }));

  const enableCurrent = () => {
    $("tower").querySelectorAll(".tw-tile").forEach((t) => (t.disabled = true));
    $("tower").querySelectorAll(`.tw-row[data-row="${round.level}"] .tw-tile`).forEach((t) => (t.disabled = false));
  };

  function buildTower() {
    const el = $("tower"); el.innerHTML = "";
    for (let r = round.rows - 1; r >= 0; r--) {
      const row = document.createElement("div");
      row.className = "tw-row"; row.dataset.row = r;
      const tiles = Array.from({ length: round.tiles }, (_, t) => `<button class="tw-tile" data-tile="${t}">❔</button>`).join("");
      row.innerHTML = `<span class="tw-mult">${round.multipliers[r].toFixed(2)}×</span><div class="tw-tiles">${tiles}</div>`;
      el.appendChild(row);
    }
    highlight();
    el.querySelectorAll(".tw-tile").forEach((t) => t.addEventListener("click", onPick));
    enableCurrent();
  }

  function highlight() {
    $("tower").querySelectorAll(".tw-row").forEach((row) => {
      const r = +row.dataset.row;
      row.classList.toggle("active", r === round.level);
      row.classList.toggle("locked", r > round.level);
      row.classList.toggle("done", r < round.level);
    });
  }

  function revealRow(rowEl, traps, picked, boom) {
    rowEl.querySelectorAll(".tw-tile").forEach((t) => {
      const idx = +t.dataset.tile, isTrap = traps.includes(idx);
      t.textContent = isTrap ? "💀" : "🐉";
      t.classList.add(isTrap ? "trap" : "safe");
      if (idx === picked) t.classList.add(boom ? "boom" : "picked");
      t.disabled = true;
    });
  }

  function revealAll(layout) {
    if (!layout) return;
    $("tower").querySelectorAll(".tw-row").forEach((row) => {
      const traps = layout[+row.dataset.row] || [];
      row.querySelectorAll(".tw-tile").forEach((t) => {
        if (t.textContent === "❔") {
          const isTrap = traps.includes(+t.dataset.tile);
          t.textContent = isTrap ? "💀" : "🐉";
          t.classList.add("faded", isTrap ? "trap" : "safe");
        }
        t.disabled = true;
      });
    });
  }

  async function onPick(e) {
    if (!round) return;
    const btn = e.currentTarget, rowEl = btn.closest(".tw-row");
    if (+rowEl.dataset.row !== round.level) return;
    const tile = +btn.dataset.tile;
    $("tower").querySelectorAll(".tw-tile").forEach((t) => (t.disabled = true));
    try {
      const res = await ctx.api("/api/tower/pick", { roundId: round.roundId, tile });
      if (res.trap) {
        revealRow(rowEl, res.layout[res.row], tile, true);
        revealAll(res.layout);
        $("twMsg").textContent = `💀 Skull on row ${res.row + 1} — the climb ends here.`;
        $("twMsg").className = "msg lose";
        ctx.applyResult(res);
        pushRecent(ctx, "tower", `${round.diff} · fell on row ${res.row + 1}`, round.betCents, 0, false, round.nonce, round.serverSeedHash, round.clientSeed);
        endClimb();
        return;
      }
      revealRow(rowEl, res.rowTraps, tile, false);
      round.level = res.level;
      ctx.sound.reveal();
      highlight();
      if (res.cleared) {
        $("twMsg").textContent = `🐉 Top of the tower! ${res.multiplier}× — +${money(res.payoutCents - round.betCents)}`;
        $("twMsg").className = "msg win";
        finishWin(res, `${round.diff} · reached the top @${res.multiplier}×`);
      } else {
        const cash = $("twCash");
        cash.style.display = ""; cash.disabled = false;
        cash.textContent = `Cash out ${res.multiplier}× — ${money(Math.floor(round.betCents * res.multiplier))}`;
        $("twMsg").textContent = res.nextMultiplier ? `Safe! Next row pays ${res.nextMultiplier}×` : "";
        $("twMsg").className = "msg";
        enableCurrent();
      }
    } catch (err) {
      $("twMsg").textContent = err.message; $("twMsg").className = "msg lose";
      enableCurrent();
    }
  }

  async function cashOut() {
    if (!round || round.level < 1) return;
    $("twCash").disabled = true;
    try {
      const res = await ctx.api("/api/tower/cashout", { roundId: round.roundId });
      revealAll(res.layout);
      $("twMsg").textContent = `Cashed out ${res.multiplier}× — +${money(res.payoutCents - round.betCents)}`;
      $("twMsg").className = "msg win";
      finishWin(res, `${round.diff} · cashed row ${round.level} @${res.multiplier}×`);
    } catch (e) {
      $("twMsg").textContent = e.message; $("twMsg").className = "msg lose";
      $("twCash").disabled = false;
    }
  }

  function finishWin(res, detail) {
    const box = $("tower").getBoundingClientRect();
    burst(box.left + box.width / 2, box.top + 30, 1.4);
    ctx.applyResult(res);
    pushRecent(ctx, "tower", detail, round.betCents, res.payoutCents, true, round.nonce, round.serverSeedHash, round.clientSeed);
    endClimb();
  }

  function endClimb() {
    round = null;
    $("twStart").style.display = ""; $("twStart").disabled = false;
    $("twCash").style.display = "none";
    $("twDiffs").classList.remove("locked");
  }

  $("twStart").addEventListener("click", async () => {
    if (round) return;
    $("twStart").disabled = true;
    try {
      const res = await ctx.api("/api/tower/start", { stake: Number($("twStake").value), difficulty: diff });
      round = {
        roundId: res.roundId, rows: res.rows, tiles: res.tiles, traps: res.traps, level: 0,
        multipliers: res.multipliers, diff: res.difficulty, betCents: res.betCents,
        nonce: res.nonce, serverSeedHash: res.serverSeedHash, clientSeed: res.clientSeed,
      };
      ctx.applyResult(res); // balance + nonce
      buildTower();
      $("twStart").style.display = "none";
      $("twDiffs").classList.add("locked");
      $("twMsg").textContent = "Pick a tile on the lit row to climb."; $("twMsg").className = "msg";
    } catch (e) {
      $("twMsg").textContent = e.message; $("twMsg").className = "msg lose";
      $("twStart").disabled = false;
    }
  });
  $("twCash").addEventListener("click", cashOut);
}
