import test from 'node:test';
import assert from 'node:assert/strict';
import {lungeFixture} from './grifballLungeFixture';
import {startAIHammerJumpForCombatant,triggerCombatantAttackAction} from '../../src/components/grifball/combatantActions';
import {triggerEnemyHammerSwingForCombatant} from '../../src/components/grifball/enemyWeaponActions';
import {createMatch} from '../../src/sim/factory';
import {stepCombatantWeapons,resolveMixedPlayerLunge} from '../../src/sim/weapons';
import {executePlayerCombatantTradeForState} from '../../src/components/grifball/tradeRuntime';
import {idleAction} from '../../src/sim/actions';
const noop=()=>{};
test('player-initiated live trade clears a consumed main jump',()=>{
 const f=lungeFixture('attacker',true,'main_ai'),self=f.target;
 f.state.playerHP=20;self.activeWeapon='hammer';self.aiDashRemaining=self.aiHammerJumpCooldownTimer=0;
 assert.equal(startAIHammerJumpForCombatant({self,settings:f.state.settings,vel:self.vel,jumpType:'defensive',
  onMainAIHammerSwing:()=>triggerEnemyHammerSwingForCombatant(self),playSwing:noop,playJump:noop}),true);
 executePlayerCombatantTradeForState({state:f.state,combatant:self,reason:'sword_lunge_vs_hammer',evaluatePlayerKillMedals:()=>[],
  recordBotCalibrationDeath:noop,playExplosion:noop,playDeath:noop,spawnVoxelShockwaveParticles:noop,pushStatsUpdate:noop});
 assert.equal(self.hp,19);assert.equal(f.state.playerHP,19);assert.equal(self.weaponState,'ready');
 assert.equal(self.hammerJumpPlanned,false);assert.equal(self.hammerJumpType,undefined);assert.equal(self.vel.y,0);
});
test('player-initiated simulated trade clears a consumed main jump',()=>{
 const state=createMatch({seed:1,teamSizes:{blue:1,red:1},combatExecution:'live-mixed-v1'});
 state.match.phase='playing';const [attacker,target]=state.combatants;state.localPlayerId=attacker.id;
 attacker.weapon='sword';attacker.pos={x:0,y:0,z:0};attacker.isLunging=true;attacker.lungeTimer=0;attacker.lungeStartPos={...attacker.pos};
 attacker.hp=attacker.maxHp=target.hp=target.maxHp=20;attacker.invulnerabilityTimer=target.invulnerabilityTimer=0;
 target.pos={x:0,y:0,z:1};target.weapon='hammer';target.attackKind='strike';target.weaponState='windup';
 target.hammerJumpPlanned=true;target.hammerJumpType='defensive';target.vel={x:0,y:0,z:0};
 resolveMixedPlayerLunge(state,attacker,state.settings,1/60,[]);
 assert.equal(attacker.hp,19);assert.equal(target.hp,19);assert.equal(target.weaponState,'idle');
 assert.equal(target.hammerJumpPlanned,false);assert.equal(target.hammerJumpType,undefined);assert.equal(target.vel.y,0);
});
for(const elapsed of [0,18]) test(`live trade consumes a deferred main jump at commitment age ${elapsed}`,()=>{
 const f=lungeFixture('attacker',true,'main_ai');f.bot.hp=f.bot.maxHp=20;
 const self=f.target;self.activeWeapon='hammer';self.aiDashRemaining=self.aiHammerJumpCooldownTimer=0;
 assert.equal(startAIHammerJumpForCombatant({self,settings:f.state.settings,vel:self.vel,jumpType:'defensive',
  onMainAIHammerSwing:()=>triggerEnemyHammerSwingForCombatant(self),playSwing:noop,playJump:noop}),true);
 assert.equal(self.hammerJumpPlanned,true);
 for(let tick=0;tick<elapsed;tick++)f.frame();
 for(let tick=0;tick<5&&f.bot.isLunging;tick++)f.frame(false,false,()=>f.flight());
 assert.equal(self.hp,19);assert.equal(f.bot.hp,19);
 assert.equal(self.weaponState,'recovering');assert.equal(self.hammerJumpPlanned,false);
 assert.equal(self.hammerJumpType,undefined);assert.equal(self.vel.y,0);
 for(let tick=0;tick<60;tick++)f.frame();
 assert.equal(self.weaponState,'ready');
 triggerCombatantAttackAction({self,weapon:'hammer',recordHammerAttack:noop,playSwing:noop});
 for(let tick=0;tick<30;tick++)f.frame();
 assert.equal(self.hammerJumpPlanned,false);assert.equal(self.vel.y,0,'a later ordinary strike cannot resurrect the consumed jump');
});
for(const phase of ['windup','active'] as const) test(`simulated trade consumes a deferred main jump during ${phase}`,()=>{
 const state=createMatch({seed:1,teamSizes:{blue:1,red:1},combatExecution:'live-roster-v2'});
 state.match.phase='playing';const [attacker,target]=state.combatants;
 attacker.weapon='sword';attacker.pos={x:0,y:0,z:0};attacker.yaw=0;
 attacker.hp=attacker.maxHp=target.hp=target.maxHp=20;
 attacker.weaponReadyTimer=attacker.invulnerabilityTimer=target.invulnerabilityTimer=0;
 attacker.lungeTargetId=target.id;target.pos={x:0,y:0,z:1};target.weapon='hammer';
 target.attackKind='strike';target.weaponState=phase;target.weaponPhaseElapsed=0;target.weaponTimer=.28;
 target.hammerJumpPlanned=true;target.hammerJumpType='defensive';target.vel={x:0,y:0,z:0};
 stepCombatantWeapons(state,attacker,{...idleAction(),attackSecondary:true},state.settings,0,[]);
 stepCombatantWeapons(state,attacker,idleAction(),state.settings,1/60,[]);
 assert.equal(attacker.hp,19);assert.equal(target.hp,19);
 assert.equal(target.weaponState,'recovering');assert.equal(target.hammerJumpPlanned,false);
 assert.equal(target.hammerJumpType,undefined);assert.equal(target.vel.y,0);
});
