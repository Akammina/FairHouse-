"""Monte-Carlo simulator for every FairHouse game.

Each game runs through the *real* provably-fair pipeline — a random server seed,
a fixed client seed, and an incrementing nonce, exactly as the live casino does —
and we measure the realised return per unit staked. From that we report:

  * RTP (return-to-player)  = mean payout per unit bet
  * house edge              = 1 - RTP
  * volatility              = standard deviation of the return (risk)
  * hit frequency           = share of rounds that pay anything

Every game nominally targets a 1% edge, but several (slots, plinko, wheel,
roulette, keno) have discrete paytables whose *true* RTP lands elsewhere — the
simulator surfaces that, and ``theoretical_rtp`` gives the closed-form value to
check the simulation against.
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Callable

from . import games as g
from .provably_fair import bet_hmac


# ---- representative bets: each returns the payout multiplier for one round ----

def _dice(hmac: str, target: float = 50.0) -> float:
    return g.dice_multiplier(target) if g.dice_roll(hmac) < target else 0.0


def _coin(hmac: str) -> float:  # always bet heads
    return g.COIN_MULTIPLIER if g.coin_result(hmac) == "heads" else 0.0


def _limbo(hmac: str, target: float = 2.0) -> float:
    return target if g.limbo_result(hmac) >= target else 0.0


def _mines(hmac: str, mines: int = 3, reveal: int = 3) -> float:
    layout = set(g.mines_layout(hmac, mines))
    safe = all(tile not in layout for tile in range(reveal))  # reveal tiles 0..reveal-1
    return g.mines_multiplier(reveal, mines) if safe else 0.0


def _tower(hmac: str, diff: str = "medium", level: int = 3) -> float:
    d = g.TOWER_DIFF[diff]
    layout = g.tower_layout(hmac, d["tiles"], d["traps"], level)
    safe = all(0 not in layout[r] for r in range(level))  # always pick column 0
    return g.tower_multiplier(diff, level) if safe else 0.0


def _plinko(hmac: str) -> float:
    return g.plinko_multiplier(g.plinko_bucket(g.plinko_path(hmac)))


def _roulette(hmac: str) -> float:  # bet red
    return g.roulette_payout(g.roulette_number(hmac), {"type": "red"})


def _wheel(hmac: str) -> float:
    return g.wheel_multiplier(g.wheel_segment(hmac))


def _keno(hmac: str, spots: int = 8) -> float:
    pick = set(range(1, spots + 1))
    hits = len(pick & set(g.keno_draw(hmac)))
    return g.keno_multiplier(spots, hits)


def _slots(hmac: str) -> float:
    return g.slot_payout(g.slot_spin(hmac))


def _hilo(hmac: str) -> float:  # bet "higher or same" on the next card
    deck = g.shuffled_deck(hmac)
    cur, nxt = deck[0] % 13, deck[1] % 13
    return g.hilo_higher_mult(cur) if nxt >= cur else 0.0


# ---- closed-form RTP for the games where it's tractable (theory vs. sim) ----

def _binom(n: int, k: int) -> float:
    return math.comb(n, k) / 2 ** n


def _theory_plinko() -> float:
    return sum(_binom(g.PLINKO_ROWS, k) * m for k, m in enumerate(g.PLINKO_MULTIPLIERS))


def _theory_wheel() -> float:
    return sum(g.WHEEL_SEGMENTS) / len(g.WHEEL_SEGMENTS)


def _theory_slots() -> float:
    # each reel uniform over SLOT_COUNT symbols; three-of-a-kind pays SLOT_PAYS[s]
    return sum(g.SLOT_PAYS) / g.SLOT_COUNT ** 3


def _theory_roulette_even() -> float:
    return 18 / 37 * 2  # red: 18 winning numbers of 37, pays 2x


def _theory_keno(spots: int = 8) -> float:
    # hypergeometric: choose `spots`, 10 drawn from 40, count hits
    total = math.comb(g.KENO_POOL, g.KENO_DRAW)
    rtp = 0.0
    for hits in range(spots + 1):
        ways = math.comb(spots, hits) * math.comb(g.KENO_POOL - spots, g.KENO_DRAW - hits)
        if ways <= 0:
            continue
        rtp += (ways / total) * g.keno_multiplier(spots, hits)
    return rtp


@dataclass
class Game:
    play: Callable[[str], float]
    label: str
    bet: str
    theory: float | None = None
    hashes: int = 1  # per-round hash cost, used to auto-size N


GAMES: dict[str, Game] = {
    "dice": Game(_dice, "Dice", "roll under 50", 0.99),
    "coinflip": Game(_coin, "Coinflip", "bet heads", 0.99),
    "limbo": Game(_limbo, "Limbo", "cash out at 2.00x", 0.99),
    "crash": Game(_limbo, "Crash", "auto-cash at 2.00x", 0.99),  # crash point = limbo formula
    "mines": Game(_mines, "Mines", "3 mines, reveal 3", 0.99, hashes=25),
    "tower": Game(_tower, "Dragon Tower", "medium, climb 3", 0.99, hashes=9),
    "plinko": Game(_plinko, "Plinko", "12 rows", _theory_plinko(), hashes=1),
    "roulette": Game(_roulette, "Roulette", "bet red", _theory_roulette_even()),
    "wheel": Game(_wheel, "Wheel", "single spin", _theory_wheel()),
    "keno": Game(_keno, "Keno", "8 spots", _theory_keno(8), hashes=40),
    "slots": Game(_slots, "Slots", "3 reels", _theory_slots()),
    # Sequential card games (Hi-Lo, Video Poker, Blackjack) depend on draw order
    # and player strategy, so they're validated by the parity suite rather than
    # reduced to a single-bet RTP here. `_hilo` is kept for reference/experiments.
}


@dataclass
class Result:
    game: str
    label: str
    bet: str
    rounds: int
    rtp: float
    house_edge: float
    volatility: float
    hit_rate: float
    ci95: float
    theory: float | None

    def as_row(self) -> dict:
        return {
            "game": self.game, "label": self.label, "bet": self.bet, "rounds": self.rounds,
            "rtp": self.rtp, "house_edge": self.house_edge, "volatility": self.volatility,
            "hit_rate": self.hit_rate, "ci95": self.ci95, "theory": self.theory,
        }


def _auto_n(game: Game, base: int) -> int:
    # spend the round budget where hashing is cheap; scale down heavy multi-hash games
    return max(20_000, base // game.hashes)


def simulate(name: str, n: int | None = None, base: int = 1_000_000, server_seed: str | None = None) -> Result:
    game = GAMES[name]
    rounds = n if n is not None else _auto_n(game, base)
    server = server_seed or os.urandom(16).hex()
    client = "sim-client"
    play = game.play

    total = 0.0
    sq = 0.0
    wins = 0
    for nonce in range(rounds):
        ret = play(bet_hmac(server, client, nonce))
        total += ret
        sq += ret * ret
        if ret > 0:
            wins += 1

    mean = total / rounds
    var = max(0.0, sq / rounds - mean * mean)
    std = math.sqrt(var)
    return Result(
        game=name, label=game.label, bet=game.bet, rounds=rounds,
        rtp=mean, house_edge=1 - mean, volatility=std, hit_rate=wins / rounds,
        ci95=1.96 * std / math.sqrt(rounds), theory=game.theory,
    )


def simulate_all(base: int = 1_000_000, server_seed: str | None = None) -> list[Result]:
    return [simulate(name, base=base, server_seed=server_seed) for name in GAMES]
