"""Generate the charts used in the lab's README:
  1. rtp_by_game.png     — measured RTP per game vs. the nominal 99% line
  2. convergence.png     — running RTP converging to its true value (LLN)
  3. plinko_distribution — where the Plinko ball lands, and the resulting edge

Run:  python reports/charts.py   (from the math-lab/ directory)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # make `fairhouse` importable

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from fairhouse import games as g  # noqa: E402
from fairhouse.provably_fair import bet_hmac  # noqa: E402
from fairhouse.simulate import GAMES, _binom, simulate  # noqa: E402

OUT = Path(__file__).parent
INK, ACCENT, WARN, GRID = "#0f1420", "#10b981", "#e11d48", "#e5e8ef"
plt.rcParams.update({"font.size": 11, "axes.edgecolor": "#c8cdd8", "axes.grid": True,
                     "grid.color": GRID, "figure.facecolor": "white", "axes.axisbelow": True})
SEED = "charts-fixed-seed"


def chart_rtp_by_game() -> None:
    results = sorted((simulate(n, base=1_000_000, server_seed=SEED) for n in GAMES),
                     key=lambda r: r.rtp)
    labels = [r.label for r in results]
    rtps = [r.rtp * 100 for r in results]
    colors = [ACCENT if r.house_edge <= 0.015 else "#f59e0b" if r.house_edge <= 0.03 else WARN
              for r in results]

    fig, ax = plt.subplots(figsize=(9, 5.2))
    bars = ax.barh(labels, rtps, color=colors, height=0.66)
    ax.axvline(99, color=INK, ls="--", lw=1, label="99% (nominal RTP)")
    for bar, r in zip(bars, results):
        ax.text(bar.get_width() - 1.2, bar.get_y() + bar.get_height() / 2,
                f"{r.rtp * 100:.1f}%", va="center", ha="right", color="white", fontweight="bold", fontsize=9)
    ax.set_xlabel("Return to player (%)")
    ax.set_xlim(55, 101)
    ax.set_title("Measured RTP per FairHouse game (10⁶ rounds each)", fontweight="bold")
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(OUT / "rtp_by_game.png", dpi=130)
    plt.close(fig)
    print("wrote rtp_by_game.png")


def _running_rtp(game_name: str, n: int) -> list[float]:
    play = GAMES[game_name].play
    running, total = [], 0.0
    for nonce in range(n):
        total += play(bet_hmac(SEED, "c", nonce))
        if nonce % 200 == 0 and nonce > 0:
            running.append(total / (nonce + 1))
    return running


def chart_convergence() -> None:
    n = 200_000
    xs = list(range(200, n, 200))
    fig, ax = plt.subplots(figsize=(9, 5))
    for game_name, color in (("dice", ACCENT), ("slots", WARN)):
        ys = [v * 100 for v in _running_rtp(game_name, n)]
        ax.plot(xs[:len(ys)], ys, color=color, lw=1.3, label=f"{GAMES[game_name].label} (running RTP)")
        ax.axhline(GAMES[game_name].theory * 100, color=color, ls=":", lw=1)
    ax.set_xscale("log")
    ax.set_xlabel("Rounds played (log scale)")
    ax.set_ylabel("Running RTP (%)")
    ax.set_ylim(80, 115)
    ax.set_title("Law of large numbers: RTP converges (low-variance Dice vs. high-variance Slots)",
                 fontweight="bold", fontsize=11)
    ax.legend(loc="upper right")
    fig.tight_layout()
    fig.savefig(OUT / "convergence.png", dpi=130)
    plt.close(fig)
    print("wrote convergence.png")


def chart_plinko() -> None:
    buckets = list(range(len(g.PLINKO_MULTIPLIERS)))
    probs = [_binom(g.PLINKO_ROWS, k) for k in buckets]
    contrib = [p * m for p, m in zip(probs, g.PLINKO_MULTIPLIERS)]

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.6))
    ax1.bar(buckets, [p * 100 for p in probs], color=ACCENT)
    ax1.set_title("Where the ball lands", fontweight="bold")
    ax1.set_xlabel("Bucket"); ax1.set_ylabel("Probability (%)")
    ax2.bar(buckets, contrib, color="#6366f1")
    ax2.set_title("RTP contribution per bucket", fontweight="bold")
    ax2.set_xlabel("Bucket"); ax2.set_ylabel("Prob × multiplier")
    for i, m in enumerate(g.PLINKO_MULTIPLIERS):
        ax2.text(i, contrib[i], f"{m}×", ha="center", va="bottom", fontsize=7, color=INK)
    fig.suptitle(f"Plinko: edges pay 15× but are rare → total RTP {sum(contrib) * 100:.1f}%",
                 fontweight="bold")
    fig.tight_layout()
    fig.savefig(OUT / "plinko_distribution.png", dpi=130)
    plt.close(fig)
    print("wrote plinko_distribution.png")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    chart_rtp_by_game()
    chart_convergence()
    chart_plinko()
    print("done")
