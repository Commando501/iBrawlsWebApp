"""Compatibility helpers for warm-starting older SB3 checkpoints."""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Mapping

import torch
from stable_baselines3.common.save_util import load_from_zip_file


@dataclass(frozen=True)
class ActionLogitInsertion:
    factor_index: int
    insert_index: int


@dataclass(frozen=True)
class ActionHeadMigration:
    old_nvec: tuple[int, ...]
    new_nvec: tuple[int, ...]
    insertions: tuple[ActionLogitInsertion, ...]

    @property
    def factor_index(self) -> int:
        return self.insertions[0].factor_index

    @property
    def insert_index(self) -> int:
        return self.insertions[0].insert_index


@dataclass(frozen=True)
class WarmStartResult:
    exact: bool
    migration: ActionHeadMigration | None = None


class CheckpointCompatibilityError(RuntimeError):
    """Raised when an init_model cannot be loaded or safely migrated."""


def _nvec_from_action_space(action_space: Any) -> tuple[int, ...]:
    nvec = getattr(action_space, "nvec", None)
    if nvec is None:
        raise ValueError("checkpoint action_space is not MultiDiscrete")
    return tuple(int(x) for x in nvec)


def _factor_expansion_insertions(
    old_nvec: tuple[int, ...],
    new_nvec: tuple[int, ...],
) -> tuple[ActionLogitInsertion, ...]:
    if len(old_nvec) != len(new_nvec):
        raise ValueError(f"action factor count changed from {len(old_nvec)} to {len(new_nvec)}")

    insertions: list[ActionLogitInsertion] = []
    new_offset = 0
    for factor_index, (old_count, new_count) in enumerate(zip(old_nvec, new_nvec)):
        if new_count < old_count:
            raise ValueError(f"action factor {factor_index} shrank from {old_count} to {new_count}")
        added = new_count - old_count
        if added > 1:
            raise ValueError(
                f"unsupported action-factor expansion at factor {factor_index}: "
                f"{old_count} -> {new_count}"
            )
        if added:
            insertions.append(ActionLogitInsertion(factor_index, new_offset + old_count))
        new_offset += new_count

    if not insertions:
        raise ValueError("action-space factor boundaries changed without an action-head width change")
    return tuple(insertions)


def _copy_state_dict(state: Mapping[str, Any]) -> OrderedDict[str, Any]:
    copied: OrderedDict[str, Any] = OrderedDict()
    for key, value in state.items():
        copied[key] = value.clone() if torch.is_tensor(value) else value
    return copied


def migrate_policy_state_for_action_space(
    saved_policy_state: Mapping[str, Any],
    target_policy_state: Mapping[str, Any],
    old_nvec: list[int] | tuple[int, ...],
    new_nvec: list[int] | tuple[int, ...],
) -> tuple[OrderedDict[str, Any], ActionHeadMigration | None]:
    """Adapt a saved SB3 policy state dict for append-only MultiDiscrete expansions.

    SB3 flattens MultiDiscrete logits into ``policy.action_net`` rows. When a new
    choice is appended to a factor, rows after that factor must shift over. A plain
    pad-at-end would corrupt every later factor's logits.
    """
    old_nvec_t = tuple(int(x) for x in old_nvec)
    new_nvec_t = tuple(int(x) for x in new_nvec)
    migrated = _copy_state_dict(saved_policy_state)

    old_weight = saved_policy_state.get("action_net.weight")
    old_bias = saved_policy_state.get("action_net.bias")
    target_weight = target_policy_state.get("action_net.weight")
    target_bias = target_policy_state.get("action_net.bias")
    if not all(torch.is_tensor(x) for x in (old_weight, old_bias, target_weight, target_bias)):
        raise ValueError("policy state dict is missing action_net tensors")

    assert torch.is_tensor(old_weight)
    assert torch.is_tensor(old_bias)
    assert torch.is_tensor(target_weight)
    assert torch.is_tensor(target_bias)

    if old_weight.ndim != 2 or target_weight.ndim != 2 or old_bias.ndim != 1 or target_bias.ndim != 1:
        raise ValueError("unsupported action_net tensor shape")
    if int(old_weight.shape[0]) != sum(old_nvec_t) or int(old_bias.shape[0]) != sum(old_nvec_t):
        raise ValueError("saved action_net width does not match saved action space")
    if int(target_weight.shape[0]) != sum(new_nvec_t) or int(target_bias.shape[0]) != sum(new_nvec_t):
        raise ValueError("target action_net width does not match target action space")

    if old_weight.shape == target_weight.shape and old_bias.shape == target_bias.shape:
        if old_nvec_t != new_nvec_t:
            raise ValueError("action-space factor boundaries changed without an action-head width change")
        return migrated, None

    if old_weight.shape[1:] != target_weight.shape[1:]:
        raise ValueError(
            f"policy action_net input width changed from {tuple(old_weight.shape)} "
            f"to {tuple(target_weight.shape)}"
        )
    insertions = _factor_expansion_insertions(old_nvec_t, new_nvec_t)
    if int(target_weight.shape[0]) != sum(new_nvec_t) or int(old_weight.shape[0]) != sum(old_nvec_t):
        raise ValueError("action head width does not match action nvec")

    new_weight = target_weight.clone()
    new_bias = target_bias.clone()

    old_start = 0
    new_start = 0
    for old_count, new_count in zip(old_nvec_t, new_nvec_t):
        new_weight[new_start:new_start + old_count] = old_weight[old_start:old_start + old_count]
        new_bias[new_start:new_start + old_count] = old_bias[old_start:old_start + old_count]
        old_start += old_count
        new_start += new_count

    migrated["action_net.weight"] = new_weight
    migrated["action_net.bias"] = new_bias
    return migrated, ActionHeadMigration(old_nvec_t, new_nvec_t, insertions)


def warm_start_sb3_model(model: Any, checkpoint_path: str, device: Any = "auto") -> WarmStartResult:
    """Load a checkpoint, migrating the policy action head when safely possible."""
    try:
        model.set_parameters(checkpoint_path, device=device)
        return WarmStartResult(exact=True)
    except Exception as exact_error:
        try:
            data, params, _ = load_from_zip_file(checkpoint_path, device=device, load_data=True)
            if data is None or params is None:
                raise ValueError("checkpoint is missing SB3 metadata or parameters")
            saved_policy_state = params.get("policy")
            if saved_policy_state is None:
                raise ValueError("checkpoint has no policy state dict")

            old_nvec = _nvec_from_action_space(data.get("action_space"))
            new_nvec = _nvec_from_action_space(model.action_space)
            migrated_policy_state, migration = migrate_policy_state_for_action_space(
                saved_policy_state,
                model.policy.state_dict(),
                old_nvec,
                new_nvec,
            )
            if migration is None:
                raise ValueError("checkpoint did not require action-head migration")

            # Do not load the old optimizer state: it still contains buffers sized
            # for the old action head and can break the next optimizer step.
            model.set_parameters({"policy": migrated_policy_state}, exact_match=False, device=device)
            return WarmStartResult(exact=False, migration=migration)
        except Exception as migration_error:
            raise CheckpointCompatibilityError(
                "failed to load init_model "
                f"({exact_error}). Tried append-only action-head migration, but it was not "
                f"applicable ({migration_error}). Width/depth must still match the saved model."
            ) from exact_error
