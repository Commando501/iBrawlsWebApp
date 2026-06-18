from __future__ import annotations

from argparse import Namespace

from ibrawls_rl.dashboard.server import _parse_eval_sim_status
from ibrawls_rl.evaluate import expected_sim_workers_for_eval
from ibrawls_rl.envs.grifball_vec_env import SimWorkerStatusTracker


def test_parse_eval_sim_status_uses_latest_count_line():
    out = _parse_eval_sim_status([
        "[eval] 5/20",
        "[eval-sims] open=2 closing=0 closed=3 started=5 event=open pid=100",
        "[eval-sims] open=1 closing=1 closed=3 started=5 event=closing pid=100",
    ])

    assert out == {
        "open": 1,
        "closing": 1,
        "closed": 3,
        "started": 5,
        "alive": 2,
    }


def test_sim_worker_status_tracker_counts_open_closing_and_closed_workers():
    lines: list[str] = []
    tracker = SimWorkerStatusTracker(enabled=True, sink=lines.append)

    tracker.opened(10)
    tracker.opened(11)
    tracker.closing(10)
    tracker.closed(10)

    assert tracker.snapshot() == {
        "open": 1,
        "closing": 0,
        "closed": 1,
        "started": 2,
        "alive": 1,
    }
    assert lines == [
        "[eval-sims] open=1 closing=0 closed=0 started=1 event=open pid=10",
        "[eval-sims] open=2 closing=0 closed=0 started=2 event=open pid=11",
        "[eval-sims] open=1 closing=1 closed=0 started=2 event=closing pid=10",
        "[eval-sims] open=1 closing=0 closed=1 started=2 event=closed pid=10",
    ]


def test_eval_sim_status_can_include_expected_worker_total():
    lines: list[str] = []
    tracker = SimWorkerStatusTracker(enabled=True, sink=lines.append)
    tracker.configure(enabled=True, sink=lines.append, reset=True, expected=4)

    tracker.opened(21)
    tracker.closing(21)
    tracker.closed(21)

    assert tracker.snapshot() == {
        "open": 0,
        "closing": 0,
        "closed": 1,
        "started": 1,
        "alive": 0,
        "expected": 4,
        "remaining": 3,
    }
    assert lines[-1] == "[eval-sims] open=0 closing=0 closed=1 started=1 expected=4 remaining=3 event=closed pid=21"

    assert _parse_eval_sim_status(lines) == {
        "open": 0,
        "closing": 0,
        "closed": 1,
        "started": 1,
        "alive": 0,
        "expected": 4,
        "remaining": 3,
    }


def test_expected_sim_worker_count_matches_combat_matrix_shape():
    base = Namespace(mode="combat", matrix=True, mechanics_suite=False, league_snapshot=[])
    suite = Namespace(mode="combat", matrix=True, mechanics_suite=True, league_snapshot=[])
    suite_with_snapshots = Namespace(
        mode="combat",
        matrix=True,
        mechanics_suite=True,
        league_snapshot=["runs/a/final_model.zip"],
    )

    assert expected_sim_workers_for_eval(base) == 10
    assert expected_sim_workers_for_eval(suite) == 50
    assert expected_sim_workers_for_eval(suite_with_snapshots) == 80
