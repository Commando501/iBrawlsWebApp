"""Self-play league scaffolding: policy snapshots + an opponent sampler (latest + PFSP).

The SB3 baseline trains vs the built-in heuristic for a clean first learning signal. To
move to true self-play, the (CleanRL) loop periodically snapshots the learner with
:func:`save_snapshot`, then samples a frozen opponent each rollout with
:class:`OpponentSampler` and runs it for the opponent-team agents (env ``opponent='self'``,
Python supplying both sides). PFSP weights opponents by how hard they are to beat."""
from __future__ import annotations

import glob
import os
from dataclasses import dataclass, field

import numpy as np
import torch

from .policies import ActorCritic


@dataclass
class PolicySnapshot:
    name: str
    path: str
    # Running win-rate of the *learner* against this snapshot (for PFSP weighting).
    games: int = 0
    wins: int = 0

    @property
    def winrate(self) -> float:
        return self.wins / self.games if self.games else 0.5


def save_snapshot(model: ActorCritic, directory: str, step: int) -> str:
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"snapshot_{step:09d}.pt")
    torch.save(model.state_dict(), path)
    return path


def load_snapshot(model: ActorCritic, path: str, device: str = "cpu") -> ActorCritic:
    model.load_state_dict(torch.load(path, map_location=device))
    model.eval()
    return model


def discover_snapshots(directory: str) -> list[PolicySnapshot]:
    out = []
    for p in sorted(glob.glob(os.path.join(directory, "snapshot_*.pt"))):
        out.append(PolicySnapshot(name=os.path.basename(p), path=p))
    return out


@dataclass
class OpponentSampler:
    """Latest-biased PFSP sampler over frozen snapshots."""

    snapshots: list[PolicySnapshot] = field(default_factory=list)
    latest_prob: float = 0.5      # probability of always picking the most recent
    pfsp_power: float = 2.0       # sharpness of the "beat the hardest" weighting
    rng: np.random.Generator = field(default_factory=lambda: np.random.default_rng(0))

    def add(self, snapshot: PolicySnapshot) -> None:
        self.snapshots.append(snapshot)

    def sample(self) -> PolicySnapshot | None:
        if not self.snapshots:
            return None
        if self.rng.random() < self.latest_prob:
            return self.snapshots[-1]
        # PFSP: weight by (1 - winrate)^power — prefer opponents we lose to.
        weights = np.array([(1.0 - s.winrate) ** self.pfsp_power + 1e-3 for s in self.snapshots])
        weights /= weights.sum()
        return self.snapshots[int(self.rng.choice(len(self.snapshots), p=weights))]

    def record_result(self, snapshot: PolicySnapshot, learner_won: bool) -> None:
        snapshot.games += 1
        if learner_won:
            snapshot.wins += 1
