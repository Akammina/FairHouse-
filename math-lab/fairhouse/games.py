"""Faithful Python port of FairHouse's per-game math (src/shared/games.ts).

Each game maps the per-bet HMAC digest to a result deterministically, so this
module and the live TypeScript casino compute the identical outcome. The parity
test suite (tests/test_parity.py) checks this against reference values produced
by the real TypeScript. All payouts carry the same 1% house edge, though several
games' discrete paytables push their true RTP away from the nominal 99% — which
is exactly what the simulator measures.
"""
from __future__ import annotations

import math
from typing import Callable

from .provably_fair import HOUSE_EDGE, float_from_hex, sha256_hex


def _hash_sort_take(hmac: str, count: int, total: int, key: Callable[[int], str]) -> list[int]:
    """Shared primitive: label 0..total-1 with a per-item hash, sort by the hash
    string, take the first ``count``. Mirrors the ``.sort()`` deals in games.ts."""
    keyed = sorted(range(total), key=key)  # stable, lexicographic on the hex key
    return sorted(keyed[:count])


# ---------- Dice: roll under a target ----------
def dice_roll(hmac: str) -> float:
    n = int(hmac[:8], 16)  # first 32 bits
    return math.floor((n / 0x100000000) * 10000) / 100  # [0.00, 99.99]


def dice_multiplier(target: float) -> float:
    return math.floor(((100 / target) * (1 - HOUSE_EDGE)) * 10000) / 10000


def dice_win(roll: float, target: float) -> bool:
    return roll < target


DICE_TARGET_MIN, DICE_TARGET_MAX = 2, 98


# ---------- Coinflip ----------
def coin_result(hmac: str) -> str:
    return "heads" if float_from_hex(hmac) < 0.5 else "tails"


COIN_MULTIPLIER = math.floor(2 * (1 - HOUSE_EDGE) * 10000) / 10000  # 1.98


# ---------- Limbo ----------
def limbo_result(hmac: str) -> float:
    x = float_from_hex(hmac)
    raw = (1 - HOUSE_EDGE) / (1 - x)
    return 1.0 if raw < 1 else math.floor(raw * 100) / 100


def limbo_win(result: float, target: float) -> bool:
    return result >= target


LIMBO_TARGET_MIN, LIMBO_TARGET_MAX = 1.01, 1000


# ---------- Crash (same crash-point formula as Limbo) ----------
CRASH_GROWTH_RATE = math.log(2) / 5


def crash_multiplier_at(ms: float) -> float:
    return math.exp(CRASH_GROWTH_RATE * (ms / 1000))


# ---------- Mines ----------
MINES_TILES = 25


def mines_layout(hmac: str, mine_count: int) -> list[int]:
    return _hash_sort_take(hmac, mine_count, MINES_TILES, lambda tile: sha256_hex(f"{hmac}:{tile}"))


def mines_multiplier(revealed: int, mine_count: int) -> float:
    if revealed <= 0:
        return 1.0
    fair = 1.0
    for i in range(revealed):
        fair *= (MINES_TILES - i) / (MINES_TILES - mine_count - i)
    return math.floor((1 - HOUSE_EDGE) * fair * 10000) / 10000


# ---------- Dragon Tower ----------
TOWER_ROWS = 9
TOWER_DIFF = {
    "easy": {"tiles": 4, "traps": 1},
    "medium": {"tiles": 3, "traps": 1},
    "hard": {"tiles": 2, "traps": 1},
    "expert": {"tiles": 3, "traps": 2},
}


def tower_layout(hmac: str, tiles: int, traps: int, rows: int) -> list[list[int]]:
    layout = []
    for r in range(rows):
        layout.append(_hash_sort_take(hmac, traps, tiles, lambda t, r=r: sha256_hex(f"{hmac}:{r}:{t}")))
    return layout


def tower_multiplier(diff: str, level: int) -> float:
    d = TOWER_DIFF.get(diff, TOWER_DIFF["medium"])
    safe = d["tiles"] - d["traps"]
    if level <= 0:
        return 1.0
    return math.floor((1 - HOUSE_EDGE) * (d["tiles"] / safe) ** level * 10000) / 10000


# ---------- Plinko ----------
PLINKO_ROWS = 12
PLINKO_MULTIPLIERS = [15, 4, 1.5, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.5, 4, 15]


def plinko_path(hmac: str) -> list[int]:
    return [int(hmac[i], 16) % 2 for i in range(PLINKO_ROWS)]


def plinko_bucket(path: list[int]) -> int:
    return sum(path)


def plinko_multiplier(bucket: int) -> float:
    return PLINKO_MULTIPLIERS[bucket]


# ---------- Roulette (European, 0-36) ----------
ROULETTE_RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}


def roulette_number(hmac: str) -> int:
    return math.floor(float_from_hex(hmac) * 37)


def roulette_color(n: int) -> str:
    return "green" if n == 0 else "red" if n in ROULETTE_RED else "black"


def roulette_payout(n: int, bet: dict) -> float:
    red = n in ROULETTE_RED
    t = bet["type"]
    if t == "straight":
        return 36 if n == bet["number"] else 0
    if t == "red":
        return 2 if n != 0 and red else 0
    if t == "black":
        return 2 if n != 0 and not red else 0
    if t == "odd":
        return 2 if n != 0 and n % 2 == 1 else 0
    if t == "even":
        return 2 if n != 0 and n % 2 == 0 else 0
    if t == "low":
        return 2 if 1 <= n <= 18 else 0
    if t == "high":
        return 2 if 19 <= n <= 36 else 0
    if t == "dozen1":
        return 3 if 1 <= n <= 12 else 0
    if t == "dozen2":
        return 3 if 13 <= n <= 24 else 0
    if t == "dozen3":
        return 3 if 25 <= n <= 36 else 0
    return 0


# ---------- Wheel ----------
WHEEL_SEGMENTS = [0, 1.6, 0, 2, 0, 1.6, 0, 2, 0, 1.6, 0, 2, 0, 1.6, 0, 3.5, 0, 1.6, 0, 2]


def wheel_segment(hmac: str) -> int:
    return math.floor(float_from_hex(hmac) * len(WHEEL_SEGMENTS))


def wheel_multiplier(segment: int) -> float:
    return WHEEL_SEGMENTS[segment]


# ---------- Keno ----------
KENO_POOL, KENO_DRAW, KENO_MAX_PICKS = 40, 10, 10
KENO_PAYTABLE = {
    1: [0, 3.8],
    2: [0, 1, 9],
    3: [0, 0, 2.8, 25],
    4: [0, 0, 1.7, 5, 60],
    5: [0, 0, 1.2, 3, 15, 200],
    6: [0, 0, 1, 2, 6, 40, 400],
    7: [0, 0, 0, 1.5, 4, 15, 100, 700],
    8: [0, 0, 0, 1.2, 2.5, 8, 40, 200, 1000],
    9: [0, 0, 0, 1, 2, 5, 20, 80, 400, 2000],
    10: [0, 0, 0, 0.5, 1.5, 3, 12, 40, 150, 800, 5000],
}


def keno_draw(hmac: str) -> list[int]:
    keyed = sorted(range(KENO_POOL), key=lambda i: sha256_hex(f"{hmac}:{i}"))
    return sorted(x + 1 for x in keyed[:KENO_DRAW])


def keno_multiplier(spots: int, hits: int) -> float:
    row = KENO_PAYTABLE.get(spots)
    if row is None or hits >= len(row):
        return 0
    return row[hits]


# ---------- Cards ----------
def card_rank(c: int) -> int:
    return c % 13


def card_suit(c: int) -> int:
    return c // 13


def shuffled_deck(hmac: str) -> list[int]:
    return sorted(range(52), key=lambda c: sha256_hex(f"{hmac}:{c}"))


# ---------- Slots ----------
SLOT_PAYS = [70, 45, 35, 25, 20, 15]
SLOT_COUNT = len(SLOT_PAYS)


def slot_spin(hmac: str) -> list[int]:
    return [math.floor((int(hmac[n * 8:n * 8 + 8], 16) / 0x100000000) * SLOT_COUNT) for n in range(3)]


def slot_payout(reels: list[int]) -> float:
    return SLOT_PAYS[reels[0]] if reels[0] == reels[1] == reels[2] else 0


# ---------- Hi-Lo ----------
def hilo_higher_mult(rank: int) -> float:
    p = (13 - rank) / 13
    return math.floor(((1 - HOUSE_EDGE) / p) * 100) / 100


def hilo_lower_mult(rank: int) -> float:
    p = (rank + 1) / 13
    return math.floor(((1 - HOUSE_EDGE) / p) * 100) / 100


# ---------- Video Poker (Jacks-or-Better, 9/6) ----------
VPOKER_PAYS = {
    "royal": 800, "straightFlush": 50, "four": 25, "fullHouse": 9, "flush": 6,
    "straight": 4, "three": 3, "twoPair": 2, "jacks": 1, "none": 0,
}


def poker_evaluate(cards: list[int]) -> dict:
    ranks = sorted(c % 13 for c in cards)
    suits = [c // 13 for c in cards]
    flush = all(s == suits[0] for s in suits)
    uniq = sorted(set(ranks))
    straight, straight_high = False, -1
    if len(uniq) == 5:
        if ranks[4] - ranks[0] == 4:
            straight, straight_high = True, ranks[4]
        elif ranks == [0, 1, 2, 3, 12]:  # A-2-3-4-5 wheel
            straight, straight_high = True, 3
    counts: dict[int, int] = {}
    for r in ranks:
        counts[r] = counts.get(r, 0) + 1
    freqs = sorted(counts.values(), reverse=True)
    pair_ranks = [r for r, c in counts.items() if c == 2]
    P = VPOKER_PAYS
    if flush and straight and straight_high == 12:
        return {"name": "Royal Flush", "multiplier": P["royal"]}
    if flush and straight:
        return {"name": "Straight Flush", "multiplier": P["straightFlush"]}
    if freqs[0] == 4:
        return {"name": "Four of a Kind", "multiplier": P["four"]}
    if freqs[0] == 3 and len(freqs) > 1 and freqs[1] == 2:
        return {"name": "Full House", "multiplier": P["fullHouse"]}
    if flush:
        return {"name": "Flush", "multiplier": P["flush"]}
    if straight:
        return {"name": "Straight", "multiplier": P["straight"]}
    if freqs[0] == 3:
        return {"name": "Three of a Kind", "multiplier": P["three"]}
    if freqs[0] == 2 and len(freqs) > 1 and freqs[1] == 2:
        return {"name": "Two Pair", "multiplier": P["twoPair"]}
    if freqs[0] == 2 and any(r >= 9 for r in pair_ranks):
        return {"name": "Jacks or Better", "multiplier": P["jacks"]}
    return {"name": "No win", "multiplier": P["none"]}


# ---------- Blackjack ----------
def hand_value(cards: list[int]) -> int:
    total, aces = 0, 0
    for c in cards:
        r = c % 13
        total += r + 2 if r <= 8 else 11 if r == 12 else 10
        if r == 12:
            aces += 1
    while total > 21 and aces > 0:
        total -= 10
        aces -= 1
    return total


def is_blackjack(cards: list[int]) -> bool:
    return len(cards) == 2 and hand_value(cards) == 21
