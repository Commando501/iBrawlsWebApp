"""Human-baseline bands + normalized eval-matrix scoring + advisor compat rules."""
from __future__ import annotations

import json
import os
import zipfile

from ibrawls_rl import baseline
from ibrawls_rl.eval import scenario_win_score, summarize_eval_matrix, win_lift
from ibrawls_rl.dashboard.advisor import advise


def test_win_lift_normalizes_world_sizes():
    # Perfect duel = 1.0 win rate; perfect 8-FFA caps at 0.25 per policy slot.
    assert win_lift(1.0, 2) == 2.0
    assert win_lift(0.25, 8) == 2.0
    assert win_lift(0.5, 2) == 1.0    # no better than random
    assert win_lift(0.125, 8) == 1.0


def test_matrix_score_credits_big_worlds_fairly():
    perfect_duel = {"win_rate": 1.0, "draw_rate": 0.0, "team_sizes": [1, 1], "world_size": 2, "behavior": {}}
    perfect_brawl = {"win_rate": 1.0, "draw_rate": 0.0, "team_sizes": [1] * 8, "world_size": 8, "behavior": {}}
    out = summarize_eval_matrix([perfect_duel, perfect_brawl])
    assert out["mean_scenario_win_score"] == 1.0
    assert out["promotion_score"] == 1.0


def test_scenario_win_score_uses_focus_slot_random_baseline():
    assert scenario_win_score(0.5, [1, 1]) == 0.0
    assert scenario_win_score(0.125, [1] * 8) == 0.0
    assert scenario_win_score(1.0, [1] * 8) == 1.0


def test_band_penalty_zero_inside_and_grows_outside():
    bands = {"move_switch_rate": [0.05, 0.35], "dash_rate": [0.0, 0.55]}
    assert baseline.band_penalty({"move_switch_rate": 0.2, "dash_rate": 0.3}, bands) == 0.0
    inside = baseline.band_penalty({"move_switch_rate": 0.35}, bands)
    outside = baseline.band_penalty({"move_switch_rate": 0.65}, bands)
    assert inside == 0.0 and outside == 1.0  # a full band-width outside costs 1.0


def test_baseline_prefers_replay_file(tmp_path):
    p = tmp_path / "human_baseline.json"
    p.write_text(json.dumps({
        "bands": {"move_switch_rate": [0.1, 0.22]},
        "replays": 12, "samples": 34000,
    }), encoding="utf-8")
    out = baseline.load_baseline(str(p))
    assert out["source"] == "replays"
    assert out["bands"]["move_switch_rate"] == [0.1, 0.22]
    # metrics absent from the file keep their defaults
    assert out["bands"]["dash_rate"] == list(baseline.DEFAULT_BANDS["dash_rate"])


def _fake_model_zip(path: str, nvec: list[int], obs_dim: int) -> None:
    data = {
        "action_space": {"nvec": "[" + " ".join(str(x) for x in nvec) + "]"},
        "observation_space": {"_shape": [obs_dim]},
    }
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("data", json.dumps(data))


def _values(**over) -> dict:
    base = {
        "mode": "combat", "decision_interval": 5, "num_workers": 12,
        "combat_world_sizes": [2] * 24 + [4] * 12 + [8] * 4,
        "rollout_length": 256, "batch_size": 8192, "n_epochs": 4,
        "learning_rate": 3e-4, "lr_schedule": "linear", "target_kl": 0.03,
        "gamma": 0.99, "entropy_coef": 0.01, "reward_approach": 0.725,
        "reward_kill": 10.0, "reward_win": 1.0, "reward_time_penalty": 0.005,
        "combat_kill_min": 4, "match_minutes": 1.0, "total_steps": 30_000_000,
        "eval_every": 2_000_000, "randomize_enabled": False, "init_model": "",
        "frame_stack": 4, "league_worlds": 6, "league_snapshots": [],
    }
    base.update(over)
    return base


def test_advisor_flags_dominating_time_penalty():
    out = advise({}, _values(reward_time_penalty=0.25), cpus=16)
    f = next(x for x in out["findings"] if "Time penalty" in x["title"])
    assert f["level"] == "bad"
    assert 0 < f["fixes"]["reward_time_penalty"] < 0.01


def test_advisor_flags_incompatible_init_model(tmp_path):
    old = os.path.join(tmp_path, "old.zip")
    _fake_model_zip(old, nvec=[9, 3, 3, 2, 2, 2], obs_dim=140)
    out = advise({}, _values(init_model="old.zip", frame_stack=1),
                 cpus=16, project_dir=str(tmp_path))
    titles = [x["title"] for x in out["findings"]]
    assert any("auto-migrates" in t for t in titles)  # one-logit aim bump is fine

    weird = os.path.join(tmp_path, "weird.zip")
    _fake_model_zip(weird, nvec=[9, 6, 3, 2, 2, 2], obs_dim=140)
    out = advise({}, _values(init_model="weird.zip", frame_stack=1),
                 cpus=16, project_dir=str(tmp_path))
    bad = next(x for x in out["findings"] if "incompatible" in x["title"])
    assert bad["fixes"] == {"init_model": ""}


def test_advisor_flags_frame_stack_mismatch(tmp_path):
    stacked = os.path.join(tmp_path, "stacked.zip")
    _fake_model_zip(stacked, nvec=[9, 4, 3, 2, 2, 2], obs_dim=560)  # stack 4
    out = advise({}, _values(init_model="stacked.zip", frame_stack=1),
                 cpus=16, project_dir=str(tmp_path))
    f = next(x for x in out["findings"] if "frame_stack" in x["title"])
    assert f["fixes"] == {"frame_stack": 4}


def test_advisor_suggests_league_for_pure_selfplay():
    out = advise({}, _values(league_worlds=0), cpus=16)
    f = next(x for x in out["findings"] if "Pure self-play" in x["title"])
    assert f["fixes"] == {"league_worlds": 6}
