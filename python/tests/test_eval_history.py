from __future__ import annotations

from ibrawls_rl.dashboard import evalhistory
from ibrawls_rl.dashboard import server


def use_temp_history(monkeypatch, tmp_path):
    path = tmp_path / "eval_history.jsonl"
    monkeypatch.setattr(evalhistory, "HISTORY_PATH", str(path))
    return path


def reset_eval_recording(monkeypatch):
    monkeypatch.setattr(server, "_recorded_eval_key", None)
    monkeypatch.setattr(server, "_last_eval_record", None)


def test_append_preserves_full_result_and_assigns_stable_id(monkeypatch, tmp_path):
    use_temp_history(monkeypatch, tmp_path)
    record = {
        "ts": 10.0,
        "model": "runs/combat/final_model.zip",
        "mode": "combat",
        "matches": 16,
        "summary": {"promotion_score": 0.72},
        "scenarios": [{"name": "duel", "win_rate": 0.8}],
        "result": {
            "model": "runs/combat/final_model.zip",
            "mode": "combat",
            "summary": {"promotion_score": 0.72},
            "scenarios": [{"name": "duel", "win_rate": 0.8}],
            "mechanics_suite": [{"name": "low-band"}],
        },
    }

    first = evalhistory.append(record)
    second = evalhistory.append(record)
    loaded = evalhistory.load()

    assert first["id"] == second["id"]
    assert len(loaded) == 1
    assert loaded[0]["id"] == first["id"]
    assert loaded[0]["result"]["mechanics_suite"] == [{"name": "low-band"}]
    assert loaded[0]["scenarios"] == [{"name": "duel", "win_rate": 0.8}]


def test_load_normalizes_legacy_rows_and_delete_removes_one_record(monkeypatch, tmp_path):
    history_path = use_temp_history(monkeypatch, tmp_path)
    first = evalhistory.append({
        "ts": 30.0,
        "model": "runs/new/final_model.zip",
        "mode": "combat",
        "win_rate": 0.9,
    })
    history_path.write_text(
        history_path.read_text(encoding="utf-8")
        + '{"ts": 20.0, "model": "runs/legacy/final_model.zip", "mode": "grifball", "win_rate": 0.4}\n',
        encoding="utf-8",
    )

    loaded = evalhistory.load()
    legacy = next(row for row in loaded if row["model"] == "runs/legacy/final_model.zip")

    assert legacy["id"]
    assert legacy["result"]["win_rate"] == 0.4
    assert evalhistory.delete(first["id"]) is True
    assert evalhistory.delete("missing-id") is False
    assert [row["model"] for row in evalhistory.load()] == ["runs/legacy/final_model.zip"]


def test_finished_eval_with_auto_save_disabled_can_be_manually_saved(monkeypatch, tmp_path):
    use_temp_history(monkeypatch, tmp_path)
    reset_eval_recording(monkeypatch)
    status = {
        "started_at": 100.0,
        "elapsed": 5.0,
        "meta": {
            "model": "runs/combat/final_model.zip",
            "mode": "combat",
            "matches": 8,
            "num_envs": 2,
            "device": "cpu",
            "auto_save": False,
        },
        "result": {
            "model": "runs/combat/final_model.zip",
            "mode": "combat",
            "win_rate": 0.75,
            "loss_rate": 0.25,
            "episodes": 8,
            "summary": {"promotion_score": 0.75},
        },
    }

    server._record_eval_if_new(status)
    assert evalhistory.load() == []

    saved = server._manual_save_last_eval()
    assert saved["ok"] is True
    assert saved["saved"] is True
    assert evalhistory.load()[0]["result"]["summary"] == {"promotion_score": 0.75}

    duplicate = server._manual_save_last_eval()
    assert duplicate["ok"] is True
    assert duplicate["saved"] is False
    assert len(evalhistory.load()) == 1


def test_finished_eval_with_auto_save_enabled_records_once(monkeypatch, tmp_path):
    use_temp_history(monkeypatch, tmp_path)
    reset_eval_recording(monkeypatch)
    status = {
        "started_at": 200.0,
        "elapsed": 4.0,
        "meta": {
            "model": "runs/combat/final_model.zip",
            "mode": "combat",
            "matches": 4,
            "num_envs": 2,
            "device": "cpu",
            "auto_save": True,
        },
        "result": {
            "model": "runs/combat/final_model.zip",
            "mode": "combat",
            "win_rate": 1.0,
            "episodes": 4,
        },
    }

    server._record_eval_if_new(status)
    server._record_eval_if_new(status)
    history = evalhistory.load()

    assert len(history) == 1
    assert history[0]["win_rate"] == 1.0
    assert server._manual_save_last_eval()["saved"] is False
