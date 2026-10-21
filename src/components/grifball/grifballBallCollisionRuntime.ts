import { createBallCombatantColliders, type BallColliderActor } from '../../game/grifballBallColliders';
import { isBallGrabbable } from '../../game/grifballBall';
import type { GrifballRuntimeState } from './runtimeState';

export function getLiveBallContactColliders(state: GrifballRuntimeState, dt: number) {
  const actors: BallColliderActor[] = [];
  const grabbable = isBallGrabbable(state.grifball.ball);
  // Requested pickups take precedence over nudging a ball away from the grabber.
  if (!state.isObserverMode && state.playerHP > 0 && state.playerRespawnTimer <= 0 &&
      !(grabbable && state.playerPickupRequested)) {
    actors.push({
      id: 'player', pos: state.playerPos, vel: state.playerVel, yaw: state.yaw,
      isCrouching: state.isCrouching, modelType: state.playerModelType,
      activeWeapon: state.activeWeapon, isLunging: state.isLunging,
      weaponState: state.activeWeapon === 'sword' ? state.pSwordState : state.activeWeapon === 'pistol' ? state.pPistolState : state.pWeaponState,
      weaponTimer: state.activeWeapon === 'sword' ? state.pSwordTimer : state.activeWeapon === 'pistol' ? state.pPistolTimer : state.pWeaponTimer,
    });
  }
  for (const actor of state.otherPlayers.values()) {
    if (actor.isObserver || actor.hp <= 0 || (actor.respawnTimer ?? 0) > 0 ||
        grabbable && actor.pickupRequested && (actor.controller === 'ai' || state.isMultiplayer)) continue;
    actors.push({
      id: actor.id, pos: actor.pos, vel: actor.vel, yaw: actor.yaw, modelType: actor.modelType,
      isCrouching: !!actor.isCrouching, activeWeapon: actor.activeWeapon,
      weaponState: actor.weaponState ?? 'ready', weaponTimer: actor.weaponTimer ?? 0,
      isLunging: actor.isLunging || actor.aiState === 'LUNGING',
    });
  }
  return createBallCombatantColliders(actors, dt, state.settings);
}
