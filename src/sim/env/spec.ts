/**
 * The single, serializable description of the env's observation/action interface. This
 * object is what the vec-env server sends in its one-time JSON handshake; the Python
 * client builds its Gymnasium spaces from it (plan §D `spaces.py`) so dims are never
 * hard-coded on either side. Keep it pure data.
 */

import { OBS_DIM, OBS_LAYOUT, OBS_FIELDS, MAX_TEAM_SIZE } from './observation';
import { ACTION_NVEC, ACTION_DIM, ACTION_FACTORS } from './action';

export interface EnvSpec {
  obsDim: number;
  obsFields: { name: string; offset: number; size: number }[];
  actionDim: number;
  actionNvec: number[];
  actionFactors: { name: string; n: number }[];
  maxTeamSize: number;
  /** Schema version — bump on any layout change so stale Python clients fail loudly. */
  version: number;
}

export const ENV_SPEC_VERSION = 2; // v2: added pass-charge / hammer-jump / weapon-ready obs

export function buildEnvSpec(): EnvSpec {
  return {
    obsDim: OBS_DIM,
    obsFields: OBS_FIELDS.map((f) => ({
      name: f.name,
      offset: OBS_LAYOUT[f.name].offset,
      size: f.size,
    })),
    actionDim: ACTION_DIM,
    actionNvec: ACTION_NVEC,
    actionFactors: ACTION_FACTORS.map((f) => ({ name: f.name, n: f.n })),
    maxTeamSize: MAX_TEAM_SIZE,
    version: ENV_SPEC_VERSION,
  };
}
