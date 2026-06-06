/**
 * Length-prefixed binary wire protocol between the Python trainer and this Node vec-env.
 * JSON is used **only** for the one-time handshake (config in, header out); every step
 * exchanges raw little-endian typed-array bytes — no per-step JSON on the hot path.
 *
 * Frame = uint32 big-endian length prefix, then `length` bytes of payload.
 *   - Request payload: 1 opcode byte, then opcode-specific data.
 *       RESET: just the opcode.
 *       STEP : opcode + an Int32 action block (numEnvs·numAgents·actDim, little-endian).
 *       CLOSE: just the opcode.
 *   - Step response: raw concat of obs(Float32) + reward(Float32) + done(Uint8) blocks.
 *   - Reset response: the obs(Float32) block.
 * Sizes are fixed by the handshake header, so the receiver slices by known lengths.
 */

export const OPCODE = {
  HELLO: 0, // JSON config frame (request) / JSON header frame (response)
  RESET: 1,
  STEP: 2,
  CLOSE: 3,
} as const;

export type Opcode = (typeof OPCODE)[keyof typeof OPCODE];

const LE = true; // little-endian on the wire (matches numpy '<f4' / '<i4')

/** Wrap a payload in a 4-byte big-endian length prefix. */
export function writeFrame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.length);
  new DataView(out.buffer).setUint32(0, payload.length, false);
  out.set(payload, 4);
  return out;
}

/**
 * Streaming frame decoder. Push raw socket/stdin chunks; pull complete payloads. Handles
 * frames split across or coalesced within chunks.
 */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): void {
    if (this.buf.length === 0) {
      this.buf = chunk.slice();
    } else {
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf, 0);
      merged.set(chunk, this.buf.length);
      this.buf = merged;
    }
  }

  /** Next complete payload, or null if a full frame isn't buffered yet. */
  next(): Uint8Array | null {
    if (this.buf.length < 4) return null;
    const len = new DataView(this.buf.buffer, this.buf.byteOffset, 4).getUint32(0, false);
    if (this.buf.length < 4 + len) return null;
    const payload = this.buf.slice(4, 4 + len);
    this.buf = this.buf.slice(4 + len);
    return payload;
  }
}

export function opcodeOf(payload: Uint8Array): number {
  return payload[0];
}

/** Build a request payload for an opcode with no data (RESET / CLOSE). */
export function buildSimpleRequest(opcode: Opcode): Uint8Array {
  return new Uint8Array([opcode]);
}

/** Build a STEP request payload from an Int32 action block. */
export function buildStepRequest(actions: Int32Array): Uint8Array {
  const out = new Uint8Array(1 + actions.length * 4);
  out[0] = OPCODE.STEP;
  const dv = new DataView(out.buffer);
  for (let i = 0; i < actions.length; i++) dv.setInt32(1 + i * 4, actions[i], LE);
  return out;
}

/** Parse a STEP request payload's action block into an Int32Array of length `count`. */
export function parseStepRequest(payload: Uint8Array, count: number): Int32Array {
  const dv = new DataView(payload.buffer, payload.byteOffset + 1, payload.length - 1);
  const out = new Int32Array(count);
  for (let i = 0; i < count; i++) out[i] = dv.getInt32(i * 4, LE);
  return out;
}

/** Raw little-endian bytes of a Float32Array (copied so the source buffer can be reused). */
export function f32Bytes(a: Float32Array): Uint8Array {
  const out = new Uint8Array(a.length * 4);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < a.length; i++) dv.setFloat32(i * 4, a[i], LE);
  return out;
}

/** Decode little-endian Float32 bytes back into a Float32Array (test/round-trip helper). */
export function bytesToF32(bytes: Uint8Array, count: number): Float32Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = dv.getFloat32(i * 4, LE);
  return out;
}

/**
 * Step-response payload:
 *   obs(f32, n·obsDim) · reward(f32, n) · done(u8, n) · truncated(u8, n) ·
 *   nTerminal(u32) · [ idx(u32) · termObs(f32, obsDim) ] × nTerminal
 * where n = numEnvs·numAgents. Terminal observations are sent for every done agent
 * (Gymnasium convention) so the trainer can bootstrap truncations.
 */
export function buildStepResponse(
  obs: Float32Array,
  reward: Float32Array,
  done: Uint8Array,
  truncated: Uint8Array,
  terminalObs: (Float32Array | null)[],
  obsDim: number
): Uint8Array {
  const obsB = f32Bytes(obs);
  const rewB = f32Bytes(reward);
  const n = reward.length;

  const terminalIdx: number[] = [];
  for (let i = 0; i < terminalObs.length; i++) if (terminalObs[i]) terminalIdx.push(i);
  const termBlockLen = 4 + terminalIdx.length * (4 + obsDim * 4);

  const out = new Uint8Array(obsB.length + rewB.length + n + n + termBlockLen);
  let off = 0;
  out.set(obsB, off); off += obsB.length;
  out.set(rewB, off); off += rewB.length;
  out.set(done, off); off += n;
  out.set(truncated, off); off += n;

  const dv = new DataView(out.buffer);
  dv.setUint32(off, terminalIdx.length, LE); off += 4;
  for (const idx of terminalIdx) {
    dv.setUint32(off, idx, LE); off += 4;
    const term = terminalObs[idx] as Float32Array;
    for (let j = 0; j < obsDim; j++) { dv.setFloat32(off, term[j], LE); off += 4; }
  }
  return out;
}

export interface StepResponse {
  obs: Float32Array;
  reward: Float32Array;
  done: Uint8Array;
  truncated: Uint8Array;
  /** agent-flat-index -> terminal observation, for done agents. */
  terminalObs: Map<number, Float32Array>;
}

/** Split a step-response payload back into its blocks given `n` agents and `obsDim`. */
export function parseStepResponse(payload: Uint8Array, n: number, obsDim: number): StepResponse {
  let off = 0;
  const obs = bytesToF32(payload.subarray(off, off + n * obsDim * 4), n * obsDim); off += n * obsDim * 4;
  const reward = bytesToF32(payload.subarray(off, off + n * 4), n); off += n * 4;
  const done = payload.subarray(off, off + n).slice(); off += n;
  const truncated = payload.subarray(off, off + n).slice(); off += n;

  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const nTerminal = dv.getUint32(off, LE); off += 4;
  const terminalObs = new Map<number, Float32Array>();
  for (let k = 0; k < nTerminal; k++) {
    const idx = dv.getUint32(off, LE); off += 4;
    const term = new Float32Array(obsDim);
    for (let j = 0; j < obsDim; j++) { term[j] = dv.getFloat32(off, LE); off += 4; }
    terminalObs.set(idx, term);
  }
  return { obs, reward, done, truncated, terminalObs };
}
