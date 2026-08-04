"""Sanity checks on the Monte-Carlo simulator: determinism, and that measured RTP
agrees with the closed-form theory within the confidence interval."""
import pytest

from fairhouse.simulate import GAMES, simulate


def test_deterministic_with_fixed_seed():
    a = simulate("dice", base=50_000, server_seed="fixed-seed")
    b = simulate("dice", base=50_000, server_seed="fixed-seed")
    assert a.rtp == b.rtp and a.hit_rate == b.hit_rate


def test_house_edge_is_complement_of_rtp():
    r = simulate("roulette", base=50_000, server_seed="s")
    assert abs(r.house_edge - (1 - r.rtp)) < 1e-12


@pytest.mark.parametrize("game", ["plinko", "roulette", "wheel", "slots", "keno"])
def test_measured_rtp_matches_theory(game):
    r = simulate(game, base=300_000, server_seed=f"seed-{game}")
    assert r.theory is not None
    # measured mean should sit within ~4 sigma of the closed-form value
    assert abs(r.rtp - r.theory) <= max(4 * r.ci95, 0.005), (
        f"{game}: measured {r.rtp:.4f} vs theory {r.theory:.4f} (ci95 {r.ci95:.4f})"
    )


def test_all_games_run():
    for name in GAMES:
        r = simulate(name, base=20_000, server_seed="smoke")
        assert 0 <= r.rtp < 5 and 0 <= r.hit_rate <= 1
