"""API tests for the FastAPI service, including a verifier check against the same
reference fixture the parity suite uses."""
import json
from pathlib import Path

from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)
REF = json.loads((Path(__file__).parent / "reference.json").read_text())


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_verify_matches_reference():
    bet0 = REF["bets"][0]
    r = client.post("/verify", json={
        "server_seed": REF["server"], "client_seed": REF["client"], "nonce": bet0["nonce"],
    })
    assert r.status_code == 200
    body = r.json()
    assert body["hmac"] == bet0["hmac"]
    assert body["outcomes"]["dice_roll"] == bet0["diceRoll"]
    assert body["outcomes"]["roulette"]["number"] == bet0["rouletteNumber"]
    assert body["outcomes"]["mines_3"] == bet0["minesLayout3"]


def test_simulate_endpoint():
    r = client.get("/simulate/dice?base=20000")
    assert r.status_code == 200
    body = r.json()
    assert 0.9 < body["rtp"] < 1.05 and body["game"] == "dice"


def test_unknown_game_404():
    assert client.get("/simulate/poker").status_code == 404


def test_rtp_table():
    r = client.get("/rtp?base=10000")
    assert r.status_code == 200 and len(r.json()) == 11
