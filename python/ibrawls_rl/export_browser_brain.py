from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np


def env_spec_version_for_observation(observation_version: int) -> int:
    if int(observation_version) >= 3:
        return 6
    if int(observation_version) >= 2:
        return 5
    return 4


def pack_actor_layers(layers: Iterable[dict]) -> tuple[np.ndarray, list[dict]]:
    chunks: list[np.ndarray] = []
    layout: list[dict] = []
    offset = 0

    for raw in layers:
        weight = np.asarray(raw["weight"], dtype=np.float32)
        bias = np.asarray(raw["bias"], dtype=np.float32)
        if weight.ndim != 2:
            raise ValueError(f"{raw['name']} weight must be 2D")
        if bias.ndim != 1:
            raise ValueError(f"{raw['name']} bias must be 1D")

        output_dim, input_dim = weight.shape
        if int(raw["input_dim"]) != input_dim or int(raw["output_dim"]) != output_dim:
            raise ValueError(f"{raw['name']} shape metadata does not match tensors")
        if bias.shape[0] != output_dim:
            raise ValueError(f"{raw['name']} bias shape does not match output_dim")

        flat_weight = np.ascontiguousarray(weight.reshape(-1), dtype=np.float32)
        flat_bias = np.ascontiguousarray(bias.reshape(-1), dtype=np.float32)
        weight_layout = {"offset": offset, "count": int(flat_weight.size)}
        chunks.append(flat_weight)
        offset += int(flat_weight.size)
        bias_layout = {"offset": offset, "count": int(flat_bias.size)}
        chunks.append(flat_bias)
        offset += int(flat_bias.size)
        layout.append({
            "name": raw["name"],
            "inputDim": input_dim,
            "outputDim": output_dim,
            "activation": raw["activation"],
            "weights": weight_layout,
            "bias": bias_layout,
        })

    if not chunks:
        return np.asarray([], dtype=np.float32), layout
    return np.concatenate(chunks).astype(np.float32, copy=False), layout


def build_manifest(
    *,
    brain_id: str,
    label: str,
    mode: str,
    observation_version: int,
    env_spec_version: int,
    frame_stack: int,
    decision_interval: int,
    base_observation_dim: int,
    action_nvec: Sequence[int],
    weights_file: str,
    checksum_sha256: str,
    layers: list[dict],
) -> dict:
    input_dim = int(base_observation_dim) * int(frame_stack)
    return {
        "version": 1,
        "id": brain_id,
        "label": label,
        "framework": "sb3-ppo",
        "policyType": "mlp-multicategorical",
        "mode": mode,
        "observationVersion": int(observation_version),
        "envSpecVersion": int(env_spec_version),
        "frameStack": int(frame_stack),
        "decisionInterval": int(decision_interval),
        "baseObservationDim": int(base_observation_dim),
        "inputDim": input_dim,
        "actionNvec": [int(n) for n in action_nvec],
        "weightsFile": weights_file,
        "checksumSha256": checksum_sha256,
        "layers": layers,
    }


def extract_sb3_actor_layers(model) -> list[dict]:
    import torch.nn as nn

    layers: list[dict] = []
    modules = list(model.policy.mlp_extractor.policy_net)
    for index, module in enumerate(modules):
        if not isinstance(module, nn.Linear):
            continue
        activation = "tanh" if index + 1 < len(modules) and isinstance(modules[index + 1], nn.Tanh) else "linear"
        layers.append({
            "name": f"policy.{index}",
            "input_dim": int(module.in_features),
            "output_dim": int(module.out_features),
            "activation": activation,
            "weight": module.weight.detach().cpu().numpy().astype(np.float32, copy=False),
            "bias": module.bias.detach().cpu().numpy().astype(np.float32, copy=False),
        })

    action_net = model.policy.action_net
    layers.append({
        "name": "action",
        "input_dim": int(action_net.in_features),
        "output_dim": int(action_net.out_features),
        "activation": "linear",
        "weight": action_net.weight.detach().cpu().numpy().astype(np.float32, copy=False),
        "bias": action_net.bias.detach().cpu().numpy().astype(np.float32, copy=False),
    })
    return layers


def build_policy_fixture(model, action_nvec: Sequence[int]) -> dict:
    import torch

    obs_dim = int(model.observation_space.shape[0])
    obs = np.zeros((1, obs_dim), dtype=np.float32)
    with torch.no_grad():
        obs_tensor = torch.as_tensor(obs, device=model.device)
        features = model.policy.extract_features(obs_tensor)
        latent_pi, _ = model.policy.mlp_extractor(features)
        logits = model.policy.action_net(latent_pi).detach().cpu().numpy()[0].astype(np.float32)

    factors: list[int] = []
    offset = 0
    for width in action_nvec:
        segment = logits[offset:offset + int(width)]
        factors.append(int(np.argmax(segment)))
        offset += int(width)

    return {
        "zeroObservation": {
            "logits": [float(v) for v in logits],
            "factors": factors,
        }
    }


def export_browser_brain(
    *,
    model_path: Path,
    out_dir: Path,
    brain_id: str,
    label: str,
    mode: str,
    observation_version: int,
    env_spec_version: int,
    frame_stack: int,
    decision_interval: int,
    base_observation_dim: int | None,
) -> dict:
    from stable_baselines3 import PPO

    model = PPO.load(str(model_path), device="cpu")
    input_dim = int(model.observation_space.shape[0])
    if base_observation_dim is None:
      if input_dim % frame_stack != 0:
          raise ValueError(f"input_dim {input_dim} is not divisible by frame_stack {frame_stack}")
      base_observation_dim = input_dim // frame_stack
    action_nvec = [int(n) for n in model.action_space.nvec]

    packed, layout = pack_actor_layers(extract_sb3_actor_layers(model))
    checksum = hashlib.sha256(packed.tobytes()).hexdigest()
    manifest = build_manifest(
        brain_id=brain_id,
        label=label,
        mode=mode,
        observation_version=observation_version,
        env_spec_version=env_spec_version,
        frame_stack=frame_stack,
        decision_interval=decision_interval,
        base_observation_dim=base_observation_dim,
        action_nvec=action_nvec,
        weights_file="weights.bin",
        checksum_sha256=checksum,
        layers=layout,
    )

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "weights.bin").write_bytes(packed.astype("<f4", copy=False).tobytes())
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (out_dir / "fixtures.json").write_text(
        json.dumps(build_policy_fixture(model, action_nvec), indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export an SB3 PPO actor for browser inference.")
    parser.add_argument("--model", type=Path, default=Path("runs/combat_dr_v2/final_model.zip"))
    parser.add_argument("--out", type=Path, default=Path("../public/brains/combat_dr_v2"))
    parser.add_argument("--brain-id", default="combat_dr_v2")
    parser.add_argument("--label", default="CombatDRV2")
    parser.add_argument("--mode", default="combat")
    parser.add_argument("--observation-version", type=int, default=1)
    parser.add_argument("--env-spec-version", type=int, default=0)
    parser.add_argument("--frame-stack", type=int, default=4)
    parser.add_argument("--decision-interval", type=int, default=5)
    parser.add_argument("--base-observation-dim", type=int, default=None)
    args = parser.parse_args(argv)

    manifest = export_browser_brain(
        model_path=args.model,
        out_dir=args.out,
        brain_id=args.brain_id,
        label=args.label,
        mode=args.mode,
        observation_version=args.observation_version,
        env_spec_version=args.env_spec_version or env_spec_version_for_observation(args.observation_version),
        frame_stack=args.frame_stack,
        decision_interval=args.decision_interval,
        base_observation_dim=args.base_observation_dim,
    )
    print(json.dumps({
        "id": manifest["id"],
        "inputDim": manifest["inputDim"],
        "actionNvec": manifest["actionNvec"],
        "out": str(args.out),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
