"""Binary wire protocol client — the Python mirror of ``src/sim/server/protocol.ts``.

Frames are a uint32 **big-endian** length prefix followed by the payload. The payload's
first byte is an opcode; step tensors are little-endian (``<f4`` / ``<i4``). JSON is used
only for the one-time HELLO handshake.
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass
from typing import IO

import numpy as np

# Opcodes — keep in sync with protocol.ts OPCODE.
HELLO = 0
RESET = 1
STEP = 2
CLOSE = 3


def write_frame(stream: IO[bytes], payload: bytes) -> None:
    """Write a length-prefixed frame and flush."""
    stream.write(struct.pack(">I", len(payload)))
    stream.write(payload)
    stream.flush()


def read_frame(stream: IO[bytes]) -> bytes:
    """Block until a full frame is read; return its payload."""
    header = _read_exact(stream, 4)
    (length,) = struct.unpack(">I", header)
    return _read_exact(stream, length)


def _read_exact(stream: IO[bytes], n: int) -> bytes:
    chunks = []
    remaining = n
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            raise EOFError("sim server closed the pipe")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def hello_request(config: dict) -> bytes:
    return bytes([HELLO]) + json.dumps(config).encode("utf-8")


def parse_hello_response(payload: bytes) -> dict:
    assert payload[0] == HELLO, f"expected HELLO, got opcode {payload[0]}"
    return json.loads(payload[1:].decode("utf-8"))


def reset_request() -> bytes:
    return bytes([RESET])


def close_request() -> bytes:
    return bytes([CLOSE])


def step_request(actions: np.ndarray) -> bytes:
    """Pack an int32 action block (any shape) into a STEP payload."""
    a = np.ascontiguousarray(actions, dtype="<i4")
    return bytes([STEP]) + a.tobytes()


@dataclass
class StepResponse:
    obs: np.ndarray
    reward: np.ndarray
    done: np.ndarray
    truncated: np.ndarray
    # agent-flat-index -> terminal observation (obs_dim,), for done agents.
    terminal_obs: dict


def parse_step_response(payload: bytes, n_agents: int, obs_dim: int) -> StepResponse:
    """Slice a step-response payload into obs / reward / done / truncated + terminal obs.

    Layout mirrors ``buildStepResponse`` in protocol.ts:
      obs(f32) · reward(f32) · done(u8) · truncated(u8) · nTerminal(u32) ·
      [ idx(u32) · termObs(f32, obs_dim) ] × nTerminal
    """
    off = 0
    obs = np.frombuffer(payload, dtype="<f4", count=n_agents * obs_dim, offset=off)
    off += n_agents * obs_dim * 4
    reward = np.frombuffer(payload, dtype="<f4", count=n_agents, offset=off)
    off += n_agents * 4
    done = np.frombuffer(payload, dtype=np.uint8, count=n_agents, offset=off)
    off += n_agents
    truncated = np.frombuffer(payload, dtype=np.uint8, count=n_agents, offset=off)
    off += n_agents

    (n_terminal,) = struct.unpack_from("<I", payload, off)
    off += 4
    terminal_obs: dict = {}
    for _ in range(n_terminal):
        (idx,) = struct.unpack_from("<I", payload, off)
        off += 4
        term = np.frombuffer(payload, dtype="<f4", count=obs_dim, offset=off).copy()
        off += obs_dim * 4
        terminal_obs[idx] = term

    return StepResponse(
        obs=obs.reshape(n_agents, obs_dim).copy(),
        reward=reward.copy(),
        done=done.copy(),
        truncated=truncated.copy(),
        terminal_obs=terminal_obs,
    )


def parse_obs_only(payload: bytes, n_agents: int, obs_dim: int) -> np.ndarray:
    """Parse a RESET response (obs block only)."""
    obs = np.frombuffer(payload, dtype="<f4", count=n_agents * obs_dim, offset=0)
    return obs.reshape(n_agents, obs_dim).copy()
