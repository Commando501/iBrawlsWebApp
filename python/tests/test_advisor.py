"""Advisor rule engine + hardware recommendation sanity (pure functions, no sim)."""
from __future__ import annotations

import json
import os
import zipfile

from ibrawls_rl.dashboard.advisor import advise
from ibrawls_rl.hardware import HardwareInfo, recommended_values


def _fake_model_zip(path: str, nvec: list[int], obs_dim: int) -> None:
    data = {
        "action_space": {"nvec": "[" + " ".join(str(x) for x in nvec) + "]"},
        "observation_space": {"_shape": [obs_dim]},
    }
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("data", json.dumps(data))


def _values(**over) -> dict:
    base = {
        "mode": "combat",
        "decision_interval": 5,
        "num_workers": 12,
        "combat_world_sizes": [2] * 24 + [4] * 12 + [8] * 4,
        "rollout_length": 256,
        "batch_size": 8192,
        "n_epochs": 4,
        "learning_rate": 3e-4,
        "lr_schedule": "linear",
        "target_kl": 0.03,
        "gamma": 0.99,
        "entropy_coef": 0.01,
        "reward_approach": 0.05,
        "reward_kill": 1.0,
        "total_steps": 25_000_000,
        "eval_every": 2_000_000,
        "randomize_enabled": False,
        "init_model": "",
        "frame_stack": 1,
        "match_minutes": 1.5,
    }
    base.update(over)
    return base


def _series(**kw) -> dict:
    """Build {key: [[step, v], ...]} from key=list-of-values (steps auto-numbered)."""
    return {k: [[i * 1000, v] for i, v in enumerate(vals)] for k, vals in kw.items()}


def test_clean_setup_no_warnings():
    out = advise({}, _values(), cpus=16)
    assert out["verdict"]["level"] in ("good", "info")
    assert not [f for f in out["findings"] if f["level"] in ("warn", "bad")]


def test_60hz_and_idle_cores_flagged_with_fixes():
    out = advise({}, _values(decision_interval=1, num_workers=2), cpus=16)
    titles = {f["title"]: f for f in out["findings"]}
    skip = next(f for f in out["findings"] if "60Hz" in f["title"])
    assert skip["fixes"]["decision_interval"] == 5
    cores = next(f for f in out["findings"] if "cores" in f["title"].lower())
    assert cores["fixes"]["num_workers"] == 12
    assert titles  # findings exist


def test_batch_larger_than_buffer_is_bad():
    out = advise({}, _values(combat_world_sizes=[2, 2], rollout_length=128, batch_size=8192),
                 cpus=16)
    bad = [f for f in out["findings"] if f["level"] == "bad"]
    assert bad and "batch_size" in bad[0]["fixes"]
    assert bad[0]["fixes"]["batch_size"] <= 128 * 4


def test_negative_explained_variance_suggests_lower_lr():
    series = _series(**{"train/explained_variance": [0.1, 0.0, -0.3] * 3})
    out = advise(series, _values(), progress=0.4, cpus=16)
    bad = next(f for f in out["findings"] if "explained_variance" in f["title"])
    assert bad["level"] == "bad"
    assert bad["fixes"]["learning_rate"] == 1.5e-4


def test_high_kl_flags_instability():
    series = _series(**{"train/approx_kl": [0.06] * 12})
    out = advise(series, _values(target_kl=0.0), progress=0.3, cpus=16)
    f = next(x for x in out["findings"] if "KL" in x["title"])
    assert f["level"] == "bad"
    assert f["fixes"].get("target_kl") == 0.03


def test_entropy_pinned_suggests_approach_boost():
    series = _series(**{"train/entropy_loss": [-6.5, -6.4, -6.4, -6.3, -6.3, -6.3]})
    out = advise(series, _values(reward_approach=0.04), progress=0.5, cpus=16)
    f = next(x for x in out["findings"] if "committing" in x["title"])
    assert f["fixes"]["reward_approach"] == 0.06


def test_rising_reward_is_good_plateau_is_info():
    rising = _series(**{"rollout/ep_rew_mean": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]})
    out = advise(rising, _values(), progress=0.5, cpus=16)
    assert any(f["level"] == "good" and "climbing" in f["title"] for f in out["findings"])

    flat = _series(**{"rollout/ep_rew_mean": [5.0, 5.01, 5.0, 4.99, 5.0, 5.0, 5.01, 5.0]})
    out = advise(flat, _values(), progress=0.8, cpus=16)
    assert any("plateau" in f["title"].lower() for f in out["findings"])


def test_recommended_values_fit_the_target_box():
    hw = HardwareInfo(cpus=16, ram_gb=48.0, gpu_name="NVIDIA GeForce RTX 4090", gpu_vram_gb=24.0)
    rec = recommended_values(hw)
    assert rec["num_workers"] == 12
    assert rec["device"] == "cuda"
    assert rec["decision_interval"] == 5
    assert rec["combat_layout_mix"] == ["1v1x16", "1v2x6", "1v3x6", "1v7x2", "ffa4x6", "ffa8x4"]
    assert rec["combat_lone_wolf_reward_scale"] == 1.35
    agents = sum(rec["combat_world_sizes"])
    buffer = rec["rollout_length"] * agents
    assert rec["batch_size"] <= buffer
    # batch is a power of two
    assert rec["batch_size"] & (rec["batch_size"] - 1) == 0


def test_recommended_values_cpu_only_falls_back():
    hw = HardwareInfo(cpus=8, ram_gb=16.0, gpu_name=None, gpu_vram_gb=None)
    rec = recommended_values(hw)
    assert rec["device"] == "cpu"
    assert rec["width"] == 256


def test_advisor_recommends_asymmetric_lone_wolf_coverage():
    out = advise({}, _values(combat_layout_mix=[]), cpus=16)
    f = next(x for x in out["findings"] if "lone-wolf" in x["title"].lower())
    assert f["level"] == "info"
    assert f["fixes"]["combat_layout_mix"] == ["1v1x16", "1v2x6", "1v3x6", "1v7x2", "ffa4x6", "ffa8x4"]
    assert f["fixes"]["combat_lone_wolf_reward_scale"] == 1.35


def test_advisor_blocks_cross_observation_warm_start(tmp_path):
    model = os.path.join(tmp_path, "old_obs_v1.zip")
    _fake_model_zip(model, nvec=[9, 4, 4, 2, 2, 2], obs_dim=140)

    out = advise({}, _values(
        observation_version=2,
        init_model="old_obs_v1.zip",
        frame_stack=1,
    ), cpus=16, project_dir=str(tmp_path))

    f = next(x for x in out["findings"] if "observation layout" in x["title"].lower())
    assert f["level"] == "bad"
    assert f["fixes"] == {"init_model": ""}
    assert "obs v1/stack 1" in f["detail"]
