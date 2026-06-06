"""Protocol parity + end-to-end handshake (plan Verification #4).

The pure tests need no Node. ``test_handshake_and_step`` spawns the real TS vec-env server
and is skipped if the toolchain (``npx``/``tsx``) or deps aren't available.
"""
from __future__ import annotations

import shutil
import struct

import numpy as np
import pytest

from ibrawls_rl import protocol as proto


def _encode_step_response_like_ts(
    obs: np.ndarray,
    reward: np.ndarray,
    done: np.ndarray,
    truncated: np.ndarray,
    terminal: dict,
    obs_dim: int,
) -> bytes:
    """Mirror src/sim/server/protocol.ts buildStepResponse byte layout."""
    out = (
        obs.astype("<f4").tobytes()
        + reward.astype("<f4").tobytes()
        + done.astype(np.uint8).tobytes()
        + truncated.astype(np.uint8).tobytes()
    )
    out += struct.pack("<I", len(terminal))
    for idx in sorted(terminal):
        out += struct.pack("<I", idx) + terminal[idx].astype("<f4").tobytes()
    return out


def test_step_response_roundtrip():
    n_agents, obs_dim = 3, 5
    obs = np.arange(n_agents * obs_dim, dtype="<f4") * 0.1
    reward = np.array([0.5, -0.5, 1.0], dtype="<f4")
    done = np.array([0, 1, 0], dtype=np.uint8)
    truncated = np.array([0, 1, 0], dtype=np.uint8)
    terminal = {1: np.array([7, 7, 7, 7, 7], dtype="<f4")}

    payload = _encode_step_response_like_ts(obs, reward, done, truncated, terminal, obs_dim)
    r = proto.parse_step_response(payload, n_agents, obs_dim)

    assert r.obs.shape == (n_agents, obs_dim)
    np.testing.assert_allclose(r.obs.reshape(-1), obs, rtol=0, atol=1e-6)
    np.testing.assert_allclose(r.reward, reward, rtol=0, atol=1e-6)
    np.testing.assert_array_equal(r.done, done)
    np.testing.assert_array_equal(r.truncated, truncated)
    assert set(r.terminal_obs) == {1}
    np.testing.assert_allclose(r.terminal_obs[1], terminal[1], atol=1e-6)


def test_step_request_pack_is_little_endian_int32():
    actions = np.array([[0, 1, 2, 8, 3, 1]], dtype=np.int32)
    payload = proto.step_request(actions)
    assert payload[0] == proto.STEP
    back = np.frombuffer(payload[1:], dtype="<i4")
    np.testing.assert_array_equal(back, actions.reshape(-1))
    # Spot-check explicit LE byte order of the first int.
    assert payload[1:5] == struct.pack("<i", 0)


def test_frame_length_prefix_is_big_endian():
    import io
    buf = io.BytesIO()
    proto.write_frame(buf, b"abcd")
    raw = buf.getvalue()
    assert raw[:4] == struct.pack(">I", 4)
    assert raw[4:] == b"abcd"


@pytest.mark.skipif(shutil.which("npx") is None, reason="npx/tsx toolchain not available")
def test_handshake_and_step():
    try:
        from ibrawls_rl.envs.grifball_vec_env import GrifballVecEnv
    except Exception as e:  # pragma: no cover - missing python deps
        pytest.skip(f"python deps unavailable: {e}")

    env = GrifballVecEnv(num_envs=2, opponent="self", settings={"grifballGoalTarget": 2})
    try:
        # Handshake dims are internally consistent with the spaces it built.
        assert env.observation_space.shape == (env.obs_dim,)
        assert len(env.action_space.nvec) == env.act_dim

        obs = env.reset()
        assert obs.shape == (env.num_envs, env.obs_dim)
        assert np.isfinite(obs).all()

        action = np.stack([env.action_space.sample() for _ in range(env.num_envs)])
        obs, reward, done, infos = env.step(action.astype(np.int32))
        assert obs.shape == (env.num_envs, env.obs_dim)
        assert reward.shape == (env.num_envs,)
        assert done.shape == (env.num_envs,)
        assert np.isfinite(obs).all() and np.isfinite(reward).all()
        assert len(infos) == env.num_envs
    finally:
        env.close()
