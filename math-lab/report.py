"""Run the Monte-Carlo simulation for every game and print an RTP / house-edge
report. Usage:  python report.py [--base N] [--seed HEX]"""
from __future__ import annotations

import argparse
import time

from fairhouse.simulate import GAMES, simulate


def main() -> None:
    ap = argparse.ArgumentParser(description="FairHouse RTP & house-edge report")
    ap.add_argument("--base", type=int, default=1_000_000, help="round budget (auto-scaled per game)")
    ap.add_argument("--seed", type=str, default=None, help="fixed server seed (reproducible run)")
    args = ap.parse_args()

    print(f"\nFairHouse — Game Math & Fairness Lab")
    print(f"Monte-Carlo RTP report (base budget {args.base:,} rounds)\n")
    header = f"{'Game':<13}{'Bet':<20}{'Rounds':>10}{'RTP (±95% CI)':>18}{'Edge':>8}{'Vol':>7}{'Hit%':>7}{'Theory':>9}"
    print(header)
    print("-" * len(header))

    start = time.time()
    for name in GAMES:
        r = simulate(name, base=args.base, server_seed=args.seed)
        theory = f"{r.theory * 100:6.2f}%" if r.theory is not None else "    —  "
        rtp = f"{r.rtp * 100:6.2f}% ±{r.ci95 * 100:.2f}"
        print(
            f"{r.label:<13}{r.bet:<20}{r.rounds:>10,}{rtp:>18}"
            f"{r.house_edge * 100:>7.2f}%{r.volatility:>7.2f}{r.hit_rate * 100:>6.1f}%{theory:>9}"
        )
    print("-" * len(header))
    print(f"\nCompleted in {time.time() - start:.1f}s. RTP is measured over the real "
          f"provably-fair pipeline; Theory is the closed-form value where tractable.\n")


if __name__ == "__main__":
    main()
