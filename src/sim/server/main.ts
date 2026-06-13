/**
 * Vec-env transport host (default: stdio). Python spawns this as a subprocess and speaks
 * the binary {@link protocol}: a one-time JSON HELLO handshake, then RESET / STEP / CLOSE
 * frames carrying raw tensors. Obs encoding stays here in Node (cheap), so each round-trip
 * moves only flat buffers for hundreds/thousands of envs at once.
 *
 * The transport is pluggable — `runStdioServer` is engine-agnostic and could be hosted on
 * a Unix domain socket / TCP later; only the read/write wiring would change.
 *
 * Run: `npm run sim:serve` (Python normally launches it; this also runs standalone).
 * IMPORTANT: stdout carries binary frames only — all logging goes to stderr.
 */

import { VecEnv, type VecEnvConfig } from './vecEnv';
import { CombatVecEnv, type CombatVecEnvConfig } from './combatVecEnv';
import { buildStateSnapshot } from './stateSnapshot';
import { buildEnvSpec } from '../env/spec';
import { REWARD_COMPONENT_KEYS } from '../env/reward';
import {
  FrameDecoder,
  OPCODE,
  opcodeOf,
  parseStepRequest,
  buildStepResponse,
  f32Bytes,
  writeFrame,
} from './protocol';

const log = (...a: unknown[]) => process.stderr.write(a.join(' ') + '\n');

/** Encode a HELLO header response payload (opcode + JSON describing the live env). */
type SimVecEnv = VecEnv | CombatVecEnv;

function helloResponse(env: SimVecEnv, seedInfo: { baseSeed: number }): Uint8Array {
  const observationVersion = 'observationVersion' in env ? env.observationVersion : 1;
  const header = {
    ...buildEnvSpec(observationVersion),
    mode: env.mode,
    numEnvs: env.numEnvs,
    numAgents: env.numAgents,
    agentIds: env.agentIds,
    agentTeams: env.agentTeams,
    baseSeed: seedInfo.baseSeed,
    decisionInterval: env.decisionInterval,
    observationVersion,
    rewardComponentKeys: REWARD_COMPONENT_KEYS,
  };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const out = new Uint8Array(1 + json.length);
  out[0] = OPCODE.HELLO;
  out.set(json, 1);
  return out;
}

function parseHelloConfig(payload: Uint8Array): VecEnvConfig & CombatVecEnvConfig & { mode?: string } {
  const json = new TextDecoder().decode(payload.subarray(1));
  const cfg = json.trim() ? JSON.parse(json) : {};
  if (!cfg.numEnvs || cfg.numEnvs < 1) cfg.numEnvs = 1; // grifball default; ignored by combat
  return cfg;
}

export interface Transport {
  onData(cb: (chunk: Uint8Array) => void): void;
  write(frame: Uint8Array): void;
  close(): void;
}

/** Drive a VecEnv over a byte transport using the binary protocol. */
export function runServer(transport: Transport): void {
  const decoder = new FrameDecoder();
  let env: SimVecEnv | null = null;
  let baseSeed = 1;
  let actionCount = 0;

  transport.onData((chunk) => {
    decoder.push(chunk);
    let payload: Uint8Array | null;
    while ((payload = decoder.next()) !== null) {
      const op = opcodeOf(payload);
      switch (op) {
        case OPCODE.HELLO: {
          const cfg = parseHelloConfig(payload);
          baseSeed = cfg.baseSeed ?? 1;
          env = cfg.mode === 'combat' ? new CombatVecEnv(cfg) : new VecEnv(cfg);
          actionCount = env.numEnvs * env.numAgents * env.actDim;
          transport.write(writeFrame(helloResponse(env, { baseSeed })));
          log(`[sim] vec-env ready: ${env.numEnvs} envs × ${env.numAgents} agents, obsDim=${env.obsDim}`);
          break;
        }
        case OPCODE.RESET: {
          if (!env) { log('[sim] RESET before HELLO'); break; }
          const obs = env.reset();
          transport.write(writeFrame(f32Bytes(obs)));
          break;
        }
        case OPCODE.STEP: {
          if (!env) { log('[sim] STEP before HELLO'); break; }
          const actions = parseStepRequest(payload, actionCount);
          const r = env.step(actions);
          transport.write(
            writeFrame(
              buildStepResponse(
                r.obs,
                r.reward,
                r.done,
                r.truncated,
                r.info.terminalObs,
                env.obsDim,
                r.rewardComponents
              )
            )
          );
          break;
        }
        case OPCODE.STATE: {
          if (!env) { log('[sim] STATE before HELLO'); break; }
          const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
          const index = payload.length >= 5 ? dv.getUint32(1, true) : 0;
          const snapshot = buildStateSnapshot(env.getState(index));
          transport.write(writeFrame(new TextEncoder().encode(JSON.stringify(snapshot))));
          break;
        }
        case OPCODE.CLOSE: {
          log('[sim] closing');
          transport.close();
          return;
        }
        default:
          log(`[sim] unknown opcode ${op}`);
      }
    }
  });
}

/** stdio transport wiring. */
function stdioTransport(): Transport {
  return {
    onData: (cb) => process.stdin.on('data', (c: Buffer) => cb(new Uint8Array(c.buffer, c.byteOffset, c.byteLength))),
    write: (frame) => process.stdout.write(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength)),
    close: () => process.exit(0),
  };
}

// Launch over stdio when run directly.
const isMain = process.argv[1] && /sim[\\/]server[\\/]main\.[tj]s$/.test(process.argv[1]);
if (isMain) {
  runServer(stdioTransport());
}
