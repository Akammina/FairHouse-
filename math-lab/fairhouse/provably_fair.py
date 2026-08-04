"""Faithful Python port of FairHouse's provably-fair core (src/shared/provablyFair.ts).

One commitment scheme powers the whole casino:
  * the server holds a secret ``server_seed`` and publishes SHA-256(server_seed);
  * the player owns a public ``client_seed``;
  * a per-player ``nonce`` counts up once per bet, across all games.
Each bet's entropy is HMAC-SHA256(server_seed, f"{client_seed}:{nonce}"); each
game maps that digest to its own outcome (see games.py). This module reproduces
the TypeScript byte-for-byte so any real FairHouse bet can be replayed here.
"""
from __future__ import annotations

import hashlib
import hmac as _hmac

HOUSE_EDGE = 0.01


def sha256_hex(message: str) -> str:
    return hashlib.sha256(message.encode()).hexdigest()


def hmac_sha256_hex(server_seed: str, message: str) -> str:
    return _hmac.new(server_seed.encode(), message.encode(), hashlib.sha256).hexdigest()


def bet_message(client_seed: str, nonce: int) -> str:
    return f"{client_seed}:{nonce}"


def bet_hmac(server_seed: str, client_seed: str, nonce: int) -> str:
    return hmac_sha256_hex(server_seed, bet_message(client_seed, nonce))


def float_from_hex(hex_str: str) -> float:
    """A uniform float in [0, 1) from the first 52 bits of a hex digest."""
    return int(hex_str[:13], 16) / 2 ** 52
