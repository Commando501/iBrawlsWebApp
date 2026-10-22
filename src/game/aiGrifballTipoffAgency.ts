import type { TeamTactics } from './grifballTacticsConfig';
import {
  GRIFBALL_TIPOFF_PREFERENCES,
  resolveGrifballPlayerStyle,
  type GrifballPlayerStyle,
} from './grifballPlayerStyles';

export interface TipoffAgencyDecision {
  style: GrifballPlayerStyle;
  strength: number;
  teamPickupMargin: number;
  pickupMargin: number;
  challengeCushion: number;
  changedDecision: boolean;
  reason: string;
}

/** Timing preferences belong to the assigned collector or screen. They do not
 * elect extra attackers or alter physical travel, weapon or recovery estimates. */
export function resolveGrifballTipoffAgency(
  tuning: TeamTactics,
  styles: Readonly<Record<string, GrifballPlayerStyle>> | undefined,
  botId: string,
): TipoffAgencyDecision | undefined {
  const strength = tuning.tipoffAgencyStrength;
  if (!strength) return undefined;
  const style = resolveGrifballPlayerStyle(styles, botId),
    preference = GRIFBALL_TIPOFF_PREFERENCES[style];
  return {
    style,
    strength,
    teamPickupMargin: tuning.tipoffPickupMargin,
    pickupMargin: Math.max(0.1, Math.min(1.5, tuning.tipoffPickupMargin + preference.pickup * strength)),
    challengeCushion: preference.challenge * strength,
    changedDecision: false,
    reason: preference.reason,
  };
}
