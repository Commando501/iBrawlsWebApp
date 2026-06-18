# Phase 33 Reference Scaffold + Auto-Calibration

Phase 33 introduces a local-only V3 calibration pipeline for the internal Aegis prototype.

## Contract

- Canonical calibration input is the non-warped OBJ reference.
- FBX, GLB, and GLTF remain inspection-only.
- Raw reference geometry, source text, private paths, buffers, and mesh payloads are never committed or exported by the scaffold/report helpers.
- Generated output is sanitized scaffold data plus deterministic Aegis base-envelope candidate reports.
- Applied model changes stay in the procedural V3 Aegis voxel source. No runtime mesh import, player mesh upload, custom armor schema migration, or gameplay contract change is introduced.

## Current Result

The built-in Aegis source has been tuned through a gated base-envelope candidate pass. The accepted source update widens helmet, chest, shoulder, pelvis, and back envelopes toward the OBJ reference while preserving the Phase 32 lower-limb and torso-depth gates. Helmet crown taper and shoulder mirroring were tightened so the candidate remains compatible with V3 suit-fidelity and reference-proportion tests.

The readiness dashboard now exposes `Calibration Candidates`, `Download Calibration Report`, and `Copy Calibration Report`. These reports are local development evidence only; V3 remains `Not Player Ready`.
