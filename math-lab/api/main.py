"""FastAPI service for the FairHouse Game Math & Fairness Lab.

Endpoints:
  * POST /verify   reproduce every game's outcome for a given
                   (server_seed, client_seed, nonce), i.e. independently prove
                   a real FairHouse bet was not tampered with.
  * GET  /simulate run a live Monte-Carlo RTP measurement for one game.
  * GET  /rtp      the full RTP / house-edge table.

Run:  uvicorn api.main:app --reload   (from the math-lab/ directory)
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from fairhouse import games as g
from fairhouse.provably_fair import bet_hmac, float_from_hex
from fairhouse.simulate import GAMES, simulate

app = FastAPI(title="FairHouse Game Math & Fairness Lab", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


class VerifyRequest(BaseModel):
    server_seed: str = Field(..., description="The revealed server seed for the bet")
    client_seed: str = Field(..., description="The player's client seed")
    nonce: int = Field(..., ge=0, description="The per-player bet counter")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "games": list(GAMES)}


@app.get("/games")
def games() -> list[dict]:
    return [{"game": k, "label": v.label, "bet": v.bet, "theoretical_rtp": v.theory} for k, v in GAMES.items()]


@app.post("/verify")
def verify(req: VerifyRequest) -> dict:
    """Reproduce the per-bet digest and every game's outcome from it: the same
    numbers FairHouse produced, recomputed independently in Python."""
    hmac = bet_hmac(req.server_seed, req.client_seed, req.nonce)
    return {
        "input": req.model_dump(),
        "hmac": hmac,
        "float": float_from_hex(hmac),
        "outcomes": {
            "dice_roll": g.dice_roll(hmac),
            "coinflip": g.coin_result(hmac),
            "limbo": g.limbo_result(hmac),
            "roulette": {"number": g.roulette_number(hmac), "color": g.roulette_color(g.roulette_number(hmac))},
            "wheel": g.wheel_multiplier(g.wheel_segment(hmac)),
            "slots": g.slot_spin(hmac),
            "plinko_bucket": g.plinko_bucket(g.plinko_path(hmac)),
            "mines_3": g.mines_layout(hmac, 3),
            "keno_draw": g.keno_draw(hmac),
            "deck_top5": g.shuffled_deck(hmac)[:5],
        },
    }


@app.get("/simulate/{game}")
def simulate_game(game: str, base: int = 200_000) -> dict:
    if game not in GAMES:
        raise HTTPException(404, f"Unknown game '{game}'. Try one of: {', '.join(GAMES)}")
    base = max(1_000, min(base, 2_000_000))  # cap it so requests stay fast
    return simulate(game, base=base).as_row()


@app.get("/rtp")
def rtp(base: int = 200_000) -> list[dict]:
    base = max(1_000, min(base, 2_000_000))
    return [simulate(name, base=base).as_row() for name in GAMES]
