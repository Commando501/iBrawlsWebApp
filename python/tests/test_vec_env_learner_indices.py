from __future__ import annotations

from ibrawls_rl.envs.grifball_vec_env import learner_indices_from_header


class _Worker:
    def __init__(self, n_agents: int, indices=None) -> None:
        self.n_agents = n_agents
        self.learner_agent_indices = indices


def test_learner_indices_from_header_prefers_sim_declared_rows():
    worker = _Worker(5, [0, 3])

    assert learner_indices_from_header(worker) == [0, 3]


def test_learner_indices_from_header_defaults_to_all_rows_for_old_servers():
    worker = _Worker(4, None)

    assert learner_indices_from_header(worker) == [0, 1, 2, 3]
