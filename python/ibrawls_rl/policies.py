"""Actor-critic policy. For the SB3 baseline we just hand PPO an MLP ``net_arch`` via
``sb3_policy_kwargs``; the standalone :class:`ActorCritic` (PyTorch) is the shared net for
the CleanRL single-file self-play path described in the plan."""
from __future__ import annotations

from typing import Sequence

import numpy as np
import torch
import torch.nn as nn
from torch.distributions import Categorical


def sb3_policy_kwargs(width: int = 256, depth: int = 2) -> dict:
    """MLP arch shared by actor and critic for SB3's MultiInputPolicy/MlpPolicy."""
    net = [width] * depth
    return dict(net_arch=dict(pi=net, vf=net), activation_fn=nn.Tanh)


def _layer_init(layer: nn.Linear, std: float = np.sqrt(2)) -> nn.Linear:
    nn.init.orthogonal_(layer.weight, std)
    nn.init.constant_(layer.bias, 0.0)
    return layer


class ActorCritic(nn.Module):
    """Shared-trunk actor-critic over a flat obs and a MultiDiscrete action (nvec)."""

    def __init__(self, obs_dim: int, nvec: Sequence[int], width: int = 256):
        super().__init__()
        self.nvec = list(nvec)
        self.trunk = nn.Sequential(
            _layer_init(nn.Linear(obs_dim, width)), nn.Tanh(),
            _layer_init(nn.Linear(width, width)), nn.Tanh(),
        )
        self.actor_heads = nn.ModuleList(
            [_layer_init(nn.Linear(width, n), std=0.01) for n in self.nvec]
        )
        self.critic = _layer_init(nn.Linear(width, 1), std=1.0)

    def _dists(self, obs: torch.Tensor) -> list[Categorical]:
        h = self.trunk(obs)
        return [Categorical(logits=head(h)) for head in self.actor_heads]

    def value(self, obs: torch.Tensor) -> torch.Tensor:
        return self.critic(self.trunk(obs)).squeeze(-1)

    def act(self, obs: torch.Tensor, deterministic: bool = False):
        dists = self._dists(obs)
        if deterministic:
            actions = torch.stack([d.probs.argmax(dim=-1) for d in dists], dim=-1)
        else:
            actions = torch.stack([d.sample() for d in dists], dim=-1)
        logp = torch.stack([d.log_prob(actions[:, i]) for i, d in enumerate(dists)], dim=-1).sum(-1)
        value = self.critic(self.trunk(obs)).squeeze(-1)
        return actions, logp, value

    def evaluate(self, obs: torch.Tensor, actions: torch.Tensor):
        dists = self._dists(obs)
        logp = torch.stack([d.log_prob(actions[:, i]) for i, d in enumerate(dists)], dim=-1).sum(-1)
        entropy = torch.stack([d.entropy() for d in dists], dim=-1).sum(-1)
        value = self.critic(self.trunk(obs)).squeeze(-1)
        return logp, entropy, value
