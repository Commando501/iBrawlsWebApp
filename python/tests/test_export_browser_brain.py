from __future__ import annotations

import numpy as np

from ibrawls_rl.export_browser_brain import build_manifest, pack_actor_layers


def test_pack_actor_layers_writes_offsets_and_float32_blob():
    layers = [
        {
            "name": "policy.0",
            "input_dim": 2,
            "output_dim": 2,
            "activation": "tanh",
            "weight": np.array([[1, 0], [0, 1]], dtype=np.float32),
            "bias": np.array([0.1, -0.2], dtype=np.float32),
        },
        {
            "name": "action",
            "input_dim": 2,
            "output_dim": 3,
            "activation": "linear",
            "weight": np.ones((3, 2), dtype=np.float32),
            "bias": np.zeros(3, dtype=np.float32),
        },
    ]

    packed, layout = pack_actor_layers(layers)

    assert packed.dtype == np.float32
    assert packed.shape == (15,)
    assert layout[0]["weights"] == {"offset": 0, "count": 4}
    assert layout[0]["bias"] == {"offset": 4, "count": 2}
    assert layout[1]["weights"] == {"offset": 6, "count": 6}
    assert layout[1]["bias"] == {"offset": 12, "count": 3}


def test_build_manifest_pins_browser_policy_contract():
    manifest = build_manifest(
        brain_id="combat_dr_v2",
        label="CombatDRV2",
        mode="combat",
        observation_version=1,
        env_spec_version=4,
        frame_stack=4,
        decision_interval=5,
        base_observation_dim=140,
        action_nvec=[9, 4, 3, 2, 2, 2],
        weights_file="weights.bin",
        checksum_sha256="abc123",
        layers=[],
    )

    assert manifest["id"] == "combat_dr_v2"
    assert manifest["inputDim"] == 560
    assert manifest["actionNvec"] == [9, 4, 3, 2, 2, 2]
    assert manifest["policyType"] == "mlp-multicategorical"
