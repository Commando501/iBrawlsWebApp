import { createBotParityFixture } from './grifballBotExecutionParity';
import { applyPointerLockMouseLookForState, handlePlayerKeyboardActionForState, handlePlayerKeyboardReleaseForState } from '../../src/components/grifball/playerInputRuntime';
import { triggerPlayerSwordSlashForState, triggerPlayerHammerSwingForState, triggerPlayerHammerMeleeForState } from '../../src/components/grifball/playerWeaponActions';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { DEFAULT_KEYBINDINGS, type CharacterModelType } from '../../src/types';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import { setSimCarrier } from '../../src/sim/grifball';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { integrateTargetEngagementGravityForCombatant } from '../../src/components/grifball/aiEngagementFrameRuntime';
import { stepLiveGroundMotion, groundMotionAction, type GroundMotion } from './grifballGroundMotion';

const flights = {
  rising: {height:2, velocity:3, forward:.9 * Math.cos(.5)},
  falling: {height:2, velocity:-3, forward:1.1},
  landing: {height:.17, velocity:-3, forward:.9 * Math.cos(.5)},
};
const VIEW_CASES = (['live-player-v1','live-mixed-v1'] as const).flatMap(execution =>
  (['main_ai','target'] as const).flatMap(targetId => [false,true].flatMap(mirror =>
    (['rising','falling','landing'] as const).flatMap(flight => [-.5,.5].flatMap(pitch =>
      [false,true].flatMap(crouching => (['medium','large'] as const satisfies readonly CharacterModelType[]).map(model =>
        ({execution,targetId,mirror,flight,pitch,crouching,model}))))))));
export const AIRBORNE_VIEW_CASES = VIEW_CASES.flatMap(view =>
  (['slash','slam','swipe','punch'] as const).flatMap(attack =>
    (['static','approach','retreat','rise','fall'] as const).map(targetMotion => ({...view,attack,targetMotion}))));
export type AirborneViewCase = typeof AIRBORNE_VIEW_CASES[number];
const nameOf = (s: AirborneViewCase) => `airborne-view/${s.execution}/${s.targetId}/${s.mirror}/${s.flight}/${s.pitch}/${s.crouching}/${s.model}${s.attack === 'slash' ? '' : `/${s.attack}`}${s.targetMotion === 'static' ? '' : `/${s.targetMotion}-turn`}`;
const noop = () => {};

/** Authored local melee, real keyboard stance and independent live/sim movement.
 * Fixed gravity, eye interpolation and cone/sphere arithmetic form a third oracle. */
export function runAirborneViewTrace(spec: AirborneViewCase) {
  const {execution,targetId,mirror,flight,pitch,crouching,model,attack,targetMotion} = spec, start = flights[flight];
  // Slam's .05/.02 phases and punch's .05/.03 phases each consume five
  // fixed ticks. Author landing to cross the floor on the impact frame.
  const impactTick = attack === 'slam' || attack === 'punch' ? 5 : 3, height = (attack === 'slam' || attack === 'punch') && flight === 'landing' ? .32 : start.height;
  const f = createBotParityFixture('player', false, {swordSlashSpeed:.1, enableSwordTrade:false, enableHammerSwordTrade:false,
    ...(attack !== 'slash' ? {hammerSlamWindupTime:.05, hammerSlamAttackTime:.02, hammerMeleeSpeed:attack === 'punch' ? .05 : .1, attackRange:3, attackRadius:1.5} : {})}, targetId);
  const {sim,state,refs,target} = f, [self,rival] = sim.combatants, sign = mirror ? -1 : 1;
  sim.combatExecution = execution; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
  self.id = 'player'; rival.id = targetId; state.otherPlayers.delete('player');
  state.localPlayerTeam = self.team = mirror ? 'red' : 'blue'; target.team = rival.team = mirror ? 'blue' : 'red';
  self.pos = {x:0,y:height,z:0}; self.vel = {x:0,y:start.velocity,z:0}; self.isJumping = true; self.grounded = false;
  state.playerPos.set(0,height,0); state.playerVel.set(0,start.velocity,0); state.isJumping = true;
  const turning = targetMotion !== 'static', heading = mirror ? Math.PI : 0;
  self.yaw = heading - (turning ? .2 : 0); state.yaw = self.yaw + Math.PI; state.pitch = pitch - (turning ? .2 : 0);
  const forward = attack === 'slam' ? 3 * Math.cos(.5) : attack === 'punch' ? 1.8 * Math.cos(.5) : start.forward;
  target.pos.set(0,0,sign * forward); rival.pos = {x:0,y:0,z:target.pos.z}; target.modelType = rival.modelType = model;
  self.hp = self.maxHp = state.playerHP = state.playerMaxHP = rival.hp = rival.maxHp = target.hp = target.maxHp = 20;
  self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = rival.weaponReadyTimer = 0;
  self.weapon = state.activeWeapon = attack === 'slash' ? 'sword' : attack === 'punch' ? 'ball' : 'hammer'; state.pSwordState = state.pWeaponState = 'ready';
  state.pSwordTimer = state.pWeaponTimer = state.swapCooldownTimer = state.swapLockoutTimer = 0;
  if (attack === 'punch') {
    sim.match.ball.state = state.grifball.ball.state = 'held';
    sim.match.ball.holderId = state.grifball.ball.holderId = 'player';
    setSimCarrier(self,true,sim.settings);
    setGrifballCarrierForState({state,id:'player',carrying:true});
  }
  const targetAirborne = targetMotion === 'rise' || targetMotion === 'fall';
  const targetStartHeight = targetAirborne ? 1.5 : 0, targetStartVy = targetMotion === 'rise' ? 3 : targetMotion === 'fall' ? -3 : 0;
  target.pos.y = rival.pos.y = targetStartHeight; target.vel.set(0,targetStartVy,0); rival.vel = {x:0,y:targetStartVy,z:0};
  target.isJumping = rival.isJumping = targetAirborne; rival.grounded = !targetAirborne;
  const travel = targetMotion === 'approach' ? -1 : targetMotion === 'retreat' ? 1 : 0;
  const motion: GroundMotion = {walk:[{tick:1,direction:{x:0,z:sign*travel}}, {tick:7,direction:{x:0,z:0}}]};
  const moveTarget = (tick:number) => {
    if (targetAirborne) integrateTargetEngagementGravityForCombatant({self:target,
      frame:{pos:target.pos,vel:target.vel,aiState:target.aiState,timer:0,dashCooldownTimer:0,slideCooldownTimer:0,hammerJumpCooldownTimer:0},
      dt:1/60,gravityAcceleration:18,recoverCombatantAltitude:()=>false,constrainCombatantToArena:noop});
    else if (travel) stepLiveGroundMotion(f,target,motion,tick);
  };
  const targetHeight = (tick:number) => Math.max(0,targetStartHeight+targetStartVy*tick/60-18*tick*(tick+1)/7200);
  const targetForward = (tick:number) => forward+travel*5.2*Math.min(tick,6)/60;
  const differences: {tick:number;field:string;actual:unknown;expected:unknown}[] = [];
  let differenceCount = 0, firstLiveHit = 0, firstSimHit = 0;
  const check = (tick:number, field:string, actual:unknown, expected:unknown) => {
    const equal = typeof actual === 'number' && typeof expected === 'number'
      ? Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8 : actual === expected;
    if (!equal) {differenceCount++; if(differences.length < 64) differences.push({tick,field,actual,expected});}
  };
  const expectedHeight = (tick:number) => Math.max(0, height + start.velocity * tick / 60 - 18 * tick * (tick + 1) / 7200);
  const expectedCrouch = (tick:number) => !crouching ? 0 : tick < 30 ? .72 * (1 - .8 ** tick) : .72 * (1 - .8 ** 29) * .8 ** (tick - 29);
  // Neither engine's hit resolver supplies this expected result. Live local
  // melee aims from the eye at a .825-unit body center, including large radius.
  // Mixed frames resolve local weapons before roster motion; player-only frames
  // resolve all movement before weapons. Both have independently authored live order.
  const targetImpactTick = impactTick - (execution === 'live-mixed-v1' ? 1 : 0);
  const impactForward = targetForward(targetImpactTick);
  const vertical = expectedHeight(impactTick) + 1.65 - expectedCrouch(impactTick) - targetHeight(targetImpactTick) - .825;
  const distance = Math.hypot(vertical,impactForward), angle = Math.abs(Math.atan2(vertical,impactForward) + pitch);
  const bonus = model === 'large' ? .2 : 0;
  const reach = attack === 'punch' ? 1.8 : 3;
  const expectedHit = attack === 'slam' || attack === 'punch'
    ? Math.hypot(impactForward - reach * Math.cos(pitch), vertical + reach * Math.sin(pitch)) <= 1.5 + bonus
    : distance <= (attack === 'slash' ? 2.8 : 3) + bonus && angle <= 1;
  const continuations: {tick:number;state:typeof sim}[] = [];
  const frames = [];
  for (let tick = 1; tick <= 60; tick++) {
    if (tick === 1) {
      if (crouching) handlePlayerKeyboardActionForState({state,key:DEFAULT_KEYBINDINGS.crouch,rawKey:DEFAULT_KEYBINDINGS.crouch,
        repeat:false,keybindings:DEFAULT_KEYBINDINGS,keysPressed:{},isPaused:false,isPlaying:true,
        callbacks:{onPauseToggle:noop,swapPlayerWeapon:noop,recordDashObservation:noop,spawnVoxelShockwaveParticles:noop,pushStatsUpdate:noop,playCrouch:noop,playJump:noop,playDash:noop}});
      if (attack === 'slash') triggerPlayerSwordSlashForState({state,playSwing:noop,sendSync:noop});
      else if (attack === 'swipe') triggerPlayerHammerMeleeForState({state,playSwing:noop,sendSync:noop});
      else triggerPlayerHammerSwingForState({state,recordHammerAttack:noop,playSwing:noop,sendSync:noop});
    }
    if (tick === 2 && turning) applyPointerLockMouseLookForState({state,movementX:-.2/.0022,movementY:-.2/.0022,mouseSensitivity:1,mouseAcceleration:0});
    if (tick === 30) handlePlayerKeyboardReleaseForState({state,key:DEFAULT_KEYBINDINGS.crouch,keybindings:DEFAULT_KEYBINDINGS,pushStatsUpdate:noop});
    updatePlayerHorizontalMovementForState({state,refs,dt:1/60,keysPressed:{},movementKeybindings:DEFAULT_KEYBINDINGS,
      actionKeybindings:DEFAULT_KEYBINDINGS,gamepad:null,mobileJoystick:null,mobileControlsActive:false,
      sprintToggleActiveRef:{current:false},prevSprintInputRef:{current:false}});
    updatePlayerVerticalIntegrationForState({state,dt:1/60,gravityAcceleration:18,constrainCombatantToArena:noop});
    if (execution === 'live-player-v1') moveTarget(tick);
    f.weaponFrame(1/60);
    if (execution === 'live-mixed-v1') moveTarget(tick);
    const actions = {player:{...idleAction(),aim:heading - (turning && tick === 1 ? .2 : 0),aimPitch:pitch - (turning && tick === 1 ? .2 : 0),crouch:crouching && tick < 30,
      attackPrimary:tick === 1 && attack !== 'swipe',attackSecondary:tick === 1 && attack === 'swipe'}, [targetId]:groundMotionAction(rival,motion,tick,0,sim.settings)};
    stepSimulation(sim,actions,{settings:sim.settings});
    for (const saved of continuations) {
      stepSimulation(saved.state,actions,{settings:saved.state.settings});
      check(tick,`snapshot ${saved.tick} continuation`,JSON.stringify(saved.state),JSON.stringify(sim));
    }
    if (tick === impactTick - 1 || tick === 29) continuations.push({tick,state:JSON.parse(JSON.stringify(sim))});
    if (target.hp < 20 && !firstLiveHit) firstLiveHit = tick;
    if (rival.hp < 20 && !firstSimHit) firstSimHit = tick;
    const expectedYaw = heading - (turning && tick === 1 ? .2 : 0);
    const live = {yawSin:Math.sin(state.yaw-Math.PI),yawCos:Math.cos(state.yaw-Math.PI),height:state.playerPos.y,vy:state.playerVel.y,crouching:state.isCrouching,crouchAmount:state.crouchAmount,hp:target.hp,targetHeight:target.pos.y,targetZ:target.pos.z,pitch:state.pitch};
    const headless = {yawSin:Math.sin(self.yaw),yawCos:Math.cos(self.yaw),height:self.pos.y,vy:self.vel.y,crouching:self.isCrouching,crouchAmount:self.crouchAmount ?? 0,hp:rival.hp,targetHeight:rival.pos.y,targetZ:rival.pos.z,pitch:self.pitch ?? 0};
    const expected = {yawSin:Math.sin(expectedYaw),yawCos:Math.cos(expectedYaw),height:expectedHeight(tick),vy:expectedHeight(tick) === 0 ? 0 : start.velocity - 18*tick/60,
      crouching:crouching && tick < 30,crouchAmount:expectedCrouch(tick),hp:expectedHit && tick >= impactTick ? 19 : 20,targetHeight:targetHeight(tick),targetZ:sign*targetForward(tick),pitch:pitch - (turning && tick === 1 ? .2 : 0)};
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      check(tick,`live ${key}`,live[key],expected[key]); check(tick,`headless ${key}`,headless[key],expected[key]);
    }
    frames.push({tick,live,headless,expected});
  }
  check(60,'first live impact',firstLiveHit,expectedHit ? impactTick : 0);
  check(60,'first headless impact',firstSimHit,expectedHit ? impactTick : 0);
  return {name:nameOf(spec),scenario:spec,differenceCount,differences,expectedHit,firstLiveHit,firstSimHit,impactTick,
    snapshotTicks:continuations.map(s=>s.tick),frames};
}
export const runAirborneViewParity = () => AIRBORNE_VIEW_CASES.map(runAirborneViewTrace);

type CoverageTrace = Pick<ReturnType<typeof runAirborneViewTrace>, 'name' | 'scenario' | 'differenceCount' |
  'expectedHit' | 'firstLiveHit' | 'firstSimHit' | 'snapshotTicks' | 'impactTick'> & {frames:readonly unknown[];frameCount?:number};
export function airborneViewCoverage(traces: readonly CoverageTrace[]) {
  const errors: string[] = [], expected = new Set(AIRBORNE_VIEW_CASES.map(nameOf));
  let completed = 0;
  for (const name of expected) {
    const matches = traces.filter(t => t.name === name), t = matches[0];
    if (matches.length !== 1) {errors.push(`${name}: expected exactly one trace`); continue;}
    const impactTick = t.scenario.attack === 'slam' || t.scenario.attack === 'punch' ? 5 : 3;
    if (nameOf(t.scenario) !== name || t.differenceCount !== 0 || (t.frameCount ?? t.frames.length) !== 60 ||
      JSON.stringify(t.snapshotTicks) !== JSON.stringify([impactTick - 1,29]) || t.impactTick !== impactTick || typeof t.expectedHit !== 'boolean' ||
      t.firstLiveHit !== (t.expectedHit ? impactTick : 0) || t.firstSimHit !== t.firstLiveHit) errors.push(`${name}: incomplete or failed evidence`);
    else completed++;
  }
  for (const t of traces) if (!expected.has(t.name)) errors.push(`${t.name}: unexpected trace`);
  return {required:expected.size,completed,errors};
}
