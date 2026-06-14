/**
 * The single, serializable description of the env's observation/action interface. This
 * object is what the vec-env server sends in its one-time JSON handshake; the Python
 * client builds its Gymnasium spaces from it (plan §D `spaces.py`) so dims are never
 * hard-coded on either side. Keep it pure data.
 */

import {
  MAX_TEAM_SIZE,
  obsDimForVersion,
  obsFieldsForVersion,
  obsLayoutForVersion,
} from './observation';
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

export const ENV_SPEC_VERSION = 4; // v4: aim factor adds nearest-hostile targeting
export const ENV_SPEC_VERSION_V2 = 5; // v5: optional combat pressure observation block
export const ENV_SPEC_VERSION_V3 = 6; // v6: optional combat anti-bait threat observation block

export function buildEnvSpec(observationVersion = 1): EnvSpec {
  const fields = obsFieldsForVersion(observationVersion);
  const layout = obsLayoutForVersion(observationVersion);
  return {
    obsDim: obsDimForVersion(observationVersion),
    obsFields: fields.map((f) => ({
      name: f.name,
      offset: layout[f.name].offset,
      size: f.size,
    })),
    actionDim: ACTION_DIM,
    actionNvec: ACTION_NVEC,
    actionFactors: ACTION_FACTORS.map((f) => ({ name: f.name, n: f.n })),
    maxTeamSize: MAX_TEAM_SIZE,
    version: observationVersion >= 3
      ? ENV_SPEC_VERSION_V3
      : observationVersion >= 2
        ? ENV_SPEC_VERSION_V2
        : ENV_SPEC_VERSION,
  };
}
