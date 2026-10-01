import { createBotParityFixture } from './grifballBotExecutionParity';
import { handlePlayerKeyboardActionForState, handlePlayerKeyboardReleaseForState } from '../../src/components/grifball/playerInputRuntime';
import { triggerPlayerSwordSlashForState } from '../../src/components/grifball/playerWeaponActions';
import { updatePlayerHorizontalMovementForState, updatePlayerVerticalIntegrationForState } from '../../src/components/grifball/playerMovementRuntime';
import { DEFAULT_KEYBINDINGS } from '../../src/types';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';

const flights = {
  rising: {height:2, velocity:3, forward:.9 * Math.cos(.5)},
  falling: {height:2, velocity:-3, forward:1.1},
  landing: {height:.17, velocity:-3, forward:.9 * Math.cos(.5)},
};
export const AIRBORNE_VIEW_CASES = (['live-player-v1','live-mixed-v1'] as const).flatMap(execution =>
  (['main_ai','target'] as const).flatMap(targetId => [false,true].flatMap(mirror =>
    (['rising','falling','landing'] as const).flatMap(flight => [-.5,.5].flatMap(pitch =>
      [false,true].flatMap(crouching => (['medium','large'] as const).map(model =>
        ({execution,targetId,mirror,flight,pitch,crouching,model}))))))));
export type AirborneViewCase = typeof AIRBORNE_VIEW_CASES[number];
const nameOf = (s: AirborneViewCase) => `airborne-view/${s.execution}/${s.targetId}/${s.mirror}/${s.flight}/${s.pitch}/${s.crouching}/${s.model}`;
const noop = () => {};

/** Authored local slash, real keyboard stance and independent live/sim movement.
 * Fixed gravity, eye interpolation, reach and cone arithmetic form a third oracle. */
export function runAirborneViewTrace(spec: AirborneViewCase) {
  const {execution,targetId,mirror,flight,pitch,crouching,model} = spec, start = flights[flight];
  const f = createBotParityFixture('player', false, {swordSlashSpeed:.1, enableSwordTrade:false, enableHammerSwordTrade:false}, targetId);
  const {sim,state,refs,target} = f, [self,rival] = sim.combatants, sign = mirror ? -1 : 1;
  sim.combatExecution = execution; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
  self.id = 'player'; rival.id = targetId; state.otherPlayers.delete('player');
  state.localPlayerTeam = self.team = mirror ? 'red' : 'blue'; target.team = rival.team = mirror ? 'blue' : 'red';
  self.pos = {x:0,y:start.height,z:0}; self.vel = {x:0,y:start.velocity,z:0}; self.isJumping = true; self.grounded = false;
  state.playerPos.set(0,start.height,0); state.playerVel.set(0,start.velocity,0); state.isJumping = true;
  self.yaw = mirror ? Math.PI : 0; state.yaw = self.yaw + Math.PI; state.pitch = pitch;
  target.pos.set(0,0,sign * start.forward); rival.pos = {x:0,y:0,z:target.pos.z}; target.modelType = rival.modelType = model;
  self.hp = self.maxHp = state.playerHP = state.playerMaxHP = rival.hp = rival.maxHp = target.hp = target.maxHp = 20;
  self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = rival.weaponReadyTimer = 0;
  self.weapon = state.activeWeapon = 'sword'; state.pSwordState = state.pWeaponState = 'ready';
  state.pSwordTimer = state.pWeaponTimer = state.swapCooldownTimer = state.swapLockoutTimer = 0;
  const differences: {tick:number;field:string;actual:unknown;expected:unknown}[] = [];
  let differenceCount = 0, firstLiveHit = 0, firstSimHit = 0;
  const check = (tick:number, field:string, actual:unknown, expected:unknown) => {
    const equal = typeof actual === 'number' && typeof expected === 'number'
      ? Number.isFinite(actual) && Math.abs(actual - expected) < 1e-8 : actual === expected;
    if (!equal) {differenceCount++; if(differences.length < 64) differences.push({tick,field,actual,expected});}
  };
  const expectedHeight = (tick:number) => Math.max(0, start.height + start.velocity * tick / 60 - 18 * tick * (tick + 1) / 7200);
  const expectedCrouch = (tick:number) => !crouching ? 0 : tick < 30 ? .72 * (1 - .8 ** tick) : .72 * (1 - .8 ** 29) * .8 ** (tick - 29);
  // Neither engine's hit resolver supplies this expected result. Live local
  // melee aims from the eye at a .825-unit body center, including large radius.
  const vertical = expectedHeight(3) + 1.65 - expectedCrouch(3) - .825;
  const distance = Math.hypot(vertical,start.forward), angle = Math.abs(Math.atan2(vertical,start.forward) + pitch);
  const expectedHit = distance <= 2.8 + (model === 'large' ? .2 : 0) && angle <= 1;
  const continuations: {tick:number;state:typeof sim}[] = [];
  const frames = [];
  for (let tick = 1; tick <= 60; tick++) {
    if (tick === 1) {
      if (crouching) handlePlayerKeyboardActionForState({state,key:DEFAULT_KEYBINDINGS.crouch,rawKey:DEFAULT_KEYBINDINGS.crouch,
        repeat:false,keybindings:DEFAULT_KEYBINDINGS,keysPressed:{},isPaused:false,isPlaying:true,
        callbacks:{onPauseToggle:noop,swapPlayerWeapon:noop,recordDashObservation:noop,spawnVoxelShockwaveParticles:noop,pushStatsUpdate:noop,playCrouch:noop,playJump:noop,playDash:noop}});
      triggerPlayerSwordSlashForState({state,playSwing:noop,sendSync:noop});
    }
    if (tick === 30) handlePlayerKeyboardReleaseForState({state,key:DEFAULT_KEYBINDINGS.crouch,keybindings:DEFAULT_KEYBINDINGS,pushStatsUpdate:noop});
    updatePlayerHorizontalMovementForState({state,refs,dt:1/60,keysPressed:{},movementKeybindings:DEFAULT_KEYBINDINGS,
      actionKeybindings:DEFAULT_KEYBINDINGS,gamepad:null,mobileJoystick:null,mobileControlsActive:false,
      sprintToggleActiveRef:{current:false},prevSprintInputRef:{current:false}});
    updatePlayerVerticalIntegrationForState({state,dt:1/60,gravityAcceleration:18,constrainCombatantToArena:noop});
    f.weaponFrame(1/60);
    const actions = {player:{...idleAction(),aim:mirror ? Math.PI : 0,aimPitch:pitch,crouch:crouching && tick < 30,attackPrimary:tick === 1}};
    stepSimulation(sim,actions,{settings:sim.settings});
    for (const saved of continuations) {
      stepSimulation(saved.state,actions,{settings:saved.state.settings});
      check(tick,`snapshot ${saved.tick} continuation`,JSON.stringify(saved.state),JSON.stringify(sim));
    }
    if (tick === 2 || tick === 29) continuations.push({tick,state:JSON.parse(JSON.stringify(sim))});
    if (target.hp < 20 && !firstLiveHit) firstLiveHit = tick;
    if (rival.hp < 20 && !firstSimHit) firstSimHit = tick;
    const live = {height:state.playerPos.y,vy:state.playerVel.y,crouching:state.isCrouching,crouchAmount:state.crouchAmount,hp:target.hp};
    const headless = {height:self.pos.y,vy:self.vel.y,crouching:self.isCrouching,crouchAmount:self.crouchAmount ?? 0,hp:rival.hp};
    const expected = {height:expectedHeight(tick),vy:expectedHeight(tick) === 0 ? 0 : start.velocity - 18*tick/60,
      crouching:crouching && tick < 30,crouchAmount:expectedCrouch(tick),hp:expectedHit && tick >= 3 ? 19 : 20};
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      check(tick,`live ${key}`,live[key],expected[key]); check(tick,`headless ${key}`,headless[key],expected[key]);
    }
    frames.push({tick,live,headless,expected});
  }
  check(60,'first live impact',firstLiveHit,expectedHit ? 3 : 0);
  check(60,'first headless impact',firstSimHit,expectedHit ? 3 : 0);
  return {name:nameOf(spec),scenario:spec,differenceCount,differences,expectedHit,firstLiveHit,firstSimHit,
    snapshotTicks:continuations.map(s=>s.tick),frames};
}
export const runAirborneViewParity = () => AIRBORNE_VIEW_CASES.map(runAirborneViewTrace);

type CoverageTrace = Pick<ReturnType<typeof runAirborneViewTrace>, 'name' | 'scenario' | 'differenceCount' |
  'expectedHit' | 'firstLiveHit' | 'firstSimHit' | 'snapshotTicks'> & {frames:readonly unknown[];frameCount?:number};
export function airborneViewCoverage(traces: readonly CoverageTrace[]) {
  const errors: string[] = [], expected = new Set(AIRBORNE_VIEW_CASES.map(nameOf));
  let completed = 0;
  for (const name of expected) {
    const matches = traces.filter(t => t.name === name), t = matches[0];
    if (matches.length !== 1) {errors.push(`${name}: expected exactly one trace`); continue;}
    if (nameOf(t.scenario) !== name || t.differenceCount !== 0 || (t.frameCount ?? t.frames.length) !== 60 ||
      JSON.stringify(t.snapshotTicks) !== '[2,29]' || typeof t.expectedHit !== 'boolean' ||
      t.firstLiveHit !== (t.expectedHit ? 3 : 0) || t.firstSimHit !== t.firstLiveHit) errors.push(`${name}: incomplete or failed evidence`);
    else completed++;
  }
  for (const t of traces) if (!expected.has(t.name)) errors.push(`${t.name}: unexpected trace`);
  return {required:expected.size,completed,errors};
}
