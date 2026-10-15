# Grifball team AI milestone 6 validation

Validated 2026-09-26 on `codex/grifball-team-tactics`, following milestone 5 commit `1dbc053` (`feat(grifball): add predictive defense and safe passing`). Milestone 6 remains an uncommitted working-tree change. The attached implementation roadmap was not edited.

## Implemented behavior

- A pure style module resolves persistent team preferences for aggression, patience, formation width, support distance and runner risk over the existing module settings. Adjustments stay within validated ranges and preserve module toggles. Neutral preferences preserve numeric settings at normal tactical difficulty.
- Seeded choices break near ties among eligible runner routes and tank engagements. The key includes team, round, possession sequence and candidate identity; it does not consume combat randomness. Normal matches use seed 1, while Lab scenarios use the entered seed. Preferences remain stable within each possession, independent of roster iteration order. Runner alternatives must make progress and remain within 0.05 estimated risk of the best route. Existing commitment, urgent finishes, progress timeouts, tank rotation, recovery reservation and double-commit guards still apply.
- Tactical difficulty comes from the mean scripted roster level, including respawning bots and excluding remote/neural players. At the default cadence, easy teams refresh every 0.35 seconds and project carrier motion over 60% of the normal horizon; normal uses 0.20 seconds, hard 0.17 and nightmare 0.14. Custom/unknown difficulties use normal tactical timing. Easier teams permit a slightly wider score tie window. Deaths, possession changes and each goal-emergency/finish threshold interrupt cadence. No changes to speed, damage, health, reach, cooldowns or execution ownership.
- Adaptation observes nearby moving opponents' approach speed and lateral distance from the current play, at most twice per second. A bounded 24-observation history must meet both the minimum evidence count and a consistency-based confidence threshold. Confidence is a heuristic, not a calibrated probability. The default first permits adaptation after nine consistent observations (approximately 4.5 seconds). Confident compact approaches widen support; fast pressure makes runner decisions more cautious and draws escorts closer. Strength bounds the response.
- Evidence survives possession changes and deaths, but clears on round/match reset, roster identity change, disabled coordination/styles/learning, or four seconds without eligible motion. Long frames never manufacture repeated observations. Human and neural players remain observed and receive no scripted commands.
- Pass release validates with the same effective style tuning used when planning, while live module toggles and all existing throw/availability checks still gate execution.
- AI Lab Styles includes two toggles, nine validated controls, Balanced/Patient support/Aggressive pressure shortcuts, team overrides, module reset, collapsed confidence controls and diagnostics showing effective preferences, observed tendencies, confidence, timing and active adaptation. Two scenarios and active/adapted team-second metrics extend seeded A/B comparisons. Tactical schema v6 migrates v1-v5 presets without changing replay/network/cloud schemas.

## Automated checks

- Initial runner/tanking/defense/passing/configuration/Lab regression selection: **53 passed**.
- Style, live runtime and Lab focused selection: **36 passed**, including neutral/extreme tuning, visible escort differences, bounded seeded alternatives, frame-rate-independent evidence, confidence gates, stale/reset behavior, urgent overrides, human/neural isolation and identical A/B adaptation metrics.
- Full test script: **1,408 tests, 1,402 passed, 6 failed**, 396.16 seconds. The five known V3 failures remain: two-handed hammer animation pose; weapon carry grip constraints; weapon attack sweep amplitude; default character asset budget; Aegis reference proportions. An additional ArmoryPanel file-level failure reported asynchronous React activity after its last test ended (`Cannot read properties of undefined (reading 'event')`). All **10 ArmoryPanel tests passed** on an isolated rerun. No V3/Armory implementation or fixture changes are included.
- The full run preceded two additional regressions covering actual tank tie choices/recovery reservation and independent urgent distance thresholds. The final gameplay/component selection passed **458/458 tests** in 21.58 seconds, including both added regressions.
- TypeScript `tsc --noEmit`: passed with a 12 GB heap.
- Production build: passed in 68 seconds, with existing large-bundle warnings.
- `git diff --check`: passed.

## Browser verification

In-app browser at `http://localhost:3000/`, V1 models, Championship Stadium, seven scripted bots:

- Opened the Lab through AI Behavior Editor and the offline pause menu. Styles controls, advanced settings, team overrides and reset rendered and responded. Patient support changed only Blue to aggression 0.25, patience 0.85, width 0.70, support distance 0.25 and runner risk 0.25; Red remained balanced. Disabling learning retained the base style with zero evidence; disabling Styles removed its diagnostics. Module reset restored defaults.
- Identical eight-second compact-approach A/B runs with seed 1 matched every metric: 0 goals, 1 possession loss, 17 role changes, 51.45 assigned bot-seconds, 0 stuck/blocked seconds, 16 active-style team-seconds and 0 adapted team-seconds. At the default 0.70 threshold, final confidence of 51%/57% correctly kept base preferences.
- A candidate with confidence threshold 0.50 accumulated **5.32 adapted team-seconds**, versus 0 for the baseline. The inspector showed active adaptation and effective width approximately 0.53 instead of 0.50. Other reported metrics matched in this short run; this is evidence that the control affects decisions, not evidence of improved win rate.
- Responsive layout checked at 1280x800 and 390x844. At 390 px, panel width was 390 px and client/scroll widths both 389 px, with no horizontal overflow. The viewport override was reset. The Lab was left paused on Styles with defaults and a fresh style-matchup scenario.
- No framework error overlay appeared and the tested flows completed. Browser logs did contain repeated uncaught promise `DOMException: UnknownError` messages asking for a Chromium bug report, with no application stack. Their source was not established, so this run is **not** a clean-console or audio validation. Screenshot scaling under the in-app browser viewport override was inconsistent; responsive width checks used the rendered DOM as well as screenshots.

## Planning benchmark

`node --import tsx scripts/sim/grifballSpaceBench.ts`, after the full test/build processes finished, 60 refreshes per case:

| Participants | Obstacles | Cold ms | Median ms | p95 ms | Max ms |
| --- | --- | ---: | ---: | ---: | ---: |
| 8 (seven bots plus human) | No | 24.75 | 2.30 | 4.01 | 4.55 |
| 8 (seven bots plus human) | Yes | 76.14 | 12.67 | 15.53 | 18.77 |
| 32 stress case | No | 20.29 | 15.94 | 19.02 | 22.33 |
| 32 stress case | Yes | 138.86 | 131.77 | 137.30 | 141.17 |

These measure planning refresh cost, not whole-frame rendering time. Cold geometry work can still hitch, and the 32-participant obstacle case is outside a real-time frame budget. The benchmark is comparable to milestone 5; it is not a statistical performance study.

## Limits

Styles are team preferences, not learned neural policies or per-player personality editors. Adaptation summarizes observed approach/width, not hidden intent or a complete opponent model. No broad win-rate claim, batch scenario evaluation, or live/headless/neural parity is made; those remain milestone 7 work. All existing objective/route estimates remain approximations.
