import * as THREE from 'three';
import { MAIN_AI_ID } from '../../game/roster';
import { type TeamId } from '../../game/teamScoring';
import { type Combatant } from '../../types';
import { type GrifballRuntimeState } from './runtimeState';

export function updateFloatingNameplatesForState({
  state,
  camera,
  container,
  nameplateContainer,
  pool,
  isMultiplayer,
  opponentPlayerName,
  fallbackOpponentName,
}: {
  state: GrifballRuntimeState;
  camera: THREE.PerspectiveCamera | null;
  container: HTMLDivElement | null;
  nameplateContainer: HTMLDivElement | null;
  pool: Map<string, HTMLElement>;
  isMultiplayer: boolean;
  opponentPlayerName: string;
  fallbackOpponentName: string;
}): void {
  if (!camera || !container || !nameplateContainer) return;

  const activeIds = new Set<string>();

  if (state.playerHP > 0) {
    const eyePos = new THREE.Vector3(
      state.playerPos.x,
      1.65 - state.crouchAmount + state.playerPos.y,
      state.playerPos.z
    );

    const appDist = state.settings.nameVisibilityDistance !== undefined
      ? state.settings.nameVisibilityDistance
      : 15.0;

    state.otherPlayers.forEach((combatant, id) => {
      if (combatant.hp <= 0 || (combatant.respawnTimer ?? 0) > 0 || combatant.aiState === 'RESPAWNING') {
        return;
      }

      const enemyPos = combatant.pos;
      const enemyCenter = new THREE.Vector3(enemyPos.x, enemyPos.y + 0.825, enemyPos.z);
      const toEnemy = enemyCenter.clone().sub(eyePos);
      const dist = toEnemy.length();

      if (dist > appDist) {
        return;
      }

      const toEnemyDir = toEnemy.clone().normalize();
      const cameraLookDir = new THREE.Vector3(0, 0, -1)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), state.pitch)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw)
        .normalize();

      const dot = cameraLookDir.dot(toEnemyDir);
      const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
      if (angle >= 0.12) {
        return;
      }

      const headPos = new THREE.Vector3(enemyPos.x, enemyPos.y + 1.75, enemyPos.z);
      headPos.project(camera);

      if (headPos.z > 1) {
        return;
      }

      const widthHalf = container.clientWidth / 2;
      const heightHalf = container.clientHeight / 2;
      const screenX = headPos.x * widthHalf + widthHalf;
      const screenY = -headPos.y * heightHalf + heightHalf;

      let plate = pool.get(id);
      if (!plate) {
        plate = document.createElement('div');
        plate.style.position = 'absolute';
        plate.style.transform = 'translate(-50%, -100%)';
        plate.style.fontWeight = 'black';
        plate.style.fontFamily = 'monospace';
        plate.style.pointerEvents = 'none';
        plate.style.textShadow = '0 0 4px rgba(0,0,0,0.85), 0 0 10px rgba(0,0,0,0.5)';
        plate.style.zIndex = '10';
        plate.style.whiteSpace = 'nowrap';
        plate.style.transition = 'color 0.15s, font-size 0.15s, opacity 0.15s';
        nameplateContainer.appendChild(plate);
        pool.set(id, plate);
      }

      if (plate.parentElement !== nameplateContainer) {
        nameplateContainer.appendChild(plate);
      }

      plate.style.display = 'block';
      plate.style.left = `${screenX}px`;
      plate.style.top = `${screenY}px`;
      plate.style.color = state.settings.nameVisibilityColor || '#00ffff';
      plate.style.opacity = (
        state.settings.nameVisibilityOpacity !== undefined
          ? state.settings.nameVisibilityOpacity
          : 0.8
      ).toString();
      plate.style.fontSize = `${state.settings.nameVisibilityFontSize || 16}px`;

      let name = combatant.playerName;
      if (id === MAIN_AI_ID && !isMultiplayer) {
        name = opponentPlayerName || fallbackOpponentName || combatant.playerName || 'DoomBot';
      }
      plate.textContent = name;
      activeIds.add(id);
    });
  }

  pool.forEach((plate, id) => {
    if (!activeIds.has(id)) {
      plate.style.display = 'none';
    }
  });
}

const RADAR_HOSTILE_MARKER_CLASS = 'absolute w-3 h-3 bg-red-500 rounded-full border border-white/40 shadow-[0_0_12px_#ef4444] animate-pulse z-30 flex items-center justify-center';
const RADAR_FRIENDLY_MARKER_CLASS = 'absolute w-3 h-3 bg-blue-500 rounded-full border border-sky-200/60 shadow-[0_0_12px_#3b82f6] animate-pulse z-30 flex items-center justify-center';

type RadarContact = {
  id: string;
  pos: THREE.Vector3;
  hp: number;
  vel: THREE.Vector3 | null;
  isCrouching: boolean;
  team?: TeamId;
};

const collectRadarContacts = (state: GrifballRuntimeState, mainAI: Combatant | undefined): RadarContact[] => {
  const contacts: RadarContact[] = [];

  if (!state.isMultiplayer) {
    if (mainAI) {
      contacts.push({
        id: MAIN_AI_ID,
        pos: mainAI.pos,
        hp: mainAI.hp,
        vel: mainAI.vel,
        isCrouching: mainAI.isCrouching,
        team: mainAI.team,
      });
    }

    state.otherPlayers.forEach((bot, id) => {
      contacts.push({
        id,
        pos: bot.pos,
        hp: bot.hp,
        vel: bot.vel,
        isCrouching: bot.isCrouching,
        team: bot.team,
      });
    });
  } else {
    state.otherPlayers.forEach((player, id) => {
      contacts.push({
        id,
        pos: player.pos,
        hp: player.hp,
        vel: player.vel,
        isCrouching: player.isCrouching || false,
        team: player.team,
      });
    });
  }

  return contacts;
};

export function updateRadarDomForState({
  state,
  mainAI,
  radarDotPool,
}: {
  state: GrifballRuntimeState;
  mainAI: Combatant | undefined;
  radarDotPool: Map<string, HTMLElement>;
}): void {
  const isPlayerAlive = state.playerHP > 0;

  const nElem = document.getElementById('radar-compass-n');
  const eElem = document.getElementById('radar-compass-e');
  const sElem = document.getElementById('radar-compass-s');
  const wElem = document.getElementById('radar-compass-w');

  if (nElem || eElem || sElem || wElem) {
    const cosYaw = Math.cos(state.yaw);
    const sinYaw = Math.sin(state.yaw);
    const r = 58;
    const center = 72;

    if (nElem) nElem.style.transform = `translate(${center + r * sinYaw - 3.5}px, ${center - r * cosYaw - 5}px)`;
    if (eElem) eElem.style.transform = `translate(${center + r * cosYaw - 3.5}px, ${center + r * sinYaw - 5}px)`;
    if (sElem) sElem.style.transform = `translate(${center - r * sinYaw - 3.5}px, ${center + r * cosYaw - 5}px)`;
    if (wElem) wElem.style.transform = `translate(${center - r * cosYaw - 3.5}px, ${center - r * sinYaw - 5}px)`;
  }

  const enemiesContainer = document.getElementById('radar-enemies-container');
  if (enemiesContainer) {
    const maxRange = 25;
    const radarRadius = 72;
    const scale = radarRadius / maxRange;
    const forwardX = -Math.sin(state.yaw);
    const forwardZ = -Math.cos(state.yaw);
    const rightX = Math.cos(state.yaw);
    const rightZ = -Math.sin(state.yaw);
    const activeIds = new Set<string>();

    for (const contact of collectRadarContacts(state, mainAI)) {
      if (!isPlayerAlive || contact.hp <= 0) continue;

      const dx = contact.pos.x - state.playerPos.x;
      const dz = contact.pos.z - state.playerPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      const velLength = contact.vel ? contact.vel.length() : 0;
      const isCrouchMoving = contact.isCrouching && velLength > 0.15;
      if (isCrouchMoving || dist > maxRange) continue;

      const localX = dx * rightX + dz * rightZ;
      const localY = dx * forwardX + dz * forwardZ;
      const ex = localX * scale;
      const ey = -localY * scale;
      const left = radarRadius + ex - 6;
      const top = radarRadius + ey - 6;

      let dot = radarDotPool.get(contact.id);
      if (!dot) {
        dot = document.createElement('div');
        dot.style.willChange = 'transform';
        const inner = document.createElement('div');
        inner.className = 'w-1.5 h-1.5 bg-white rounded-full';
        dot.appendChild(inner);
        radarDotPool.set(contact.id, dot);
      }

      if (dot.parentElement !== enemiesContainer) {
        enemiesContainer.appendChild(dot);
      }

      dot.className = contact.team === state.localPlayerTeam
        ? RADAR_FRIENDLY_MARKER_CLASS
        : RADAR_HOSTILE_MARKER_CLASS;
      dot.style.transform = `translate(${left}px, ${top}px)`;
      dot.style.display = 'flex';
      activeIds.add(contact.id);
    }

    radarDotPool.forEach((dot, id) => {
      if (!activeIds.has(id)) dot.style.display = 'none';
    });
  }

  const playerArrow = document.getElementById('radar-player-arrow');
  if (playerArrow) {
    if (!isPlayerAlive) {
      playerArrow.style.display = 'none';
    } else {
      playerArrow.style.display = 'block';
      const playerVelLength = state.playerVel ? state.playerVel.length() : 0;
      const playerIsCrouchMoving = state.isCrouching && playerVelLength > 0.15;

      if (playerIsCrouchMoving) {
        playerArrow.setAttribute('class', 'absolute w-3.5 h-3.5 text-white/20 z-20');
        playerArrow.setAttribute('fill', 'none');
        playerArrow.setAttribute('stroke', 'currentColor');
        playerArrow.setAttribute('stroke-width', '2');
      } else {
        playerArrow.setAttribute('class', 'absolute w-3.5 h-3.5 text-[#22d3ee] drop-shadow-[0_0_4px_rgba(34,211,238,0.7)] z-20');
        playerArrow.setAttribute('fill', 'currentColor');
        playerArrow.removeAttribute('stroke');
        playerArrow.removeAttribute('stroke-width');
      }
    }
  }

  const badgeText = document.getElementById('radar-status-text');
  const badgeContainer = document.getElementById('radar-status-badge');
  if (badgeText && badgeContainer) {
    const playerVelLength = state.playerVel ? state.playerVel.length() : 0;
    const playerIsCrouchMoving = state.isCrouching && playerVelLength > 0.15;

    if (!isPlayerAlive) {
      badgeText.textContent = 'OFFLINE';
      badgeContainer.className = 'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-slate-900/40 text-slate-500 border-slate-500/20';
    } else if (playerIsCrouchMoving) {
      badgeText.textContent = 'SIGNAL STEALTH';
      badgeContainer.className = 'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-amber-950/40 text-amber-400 border-amber-500/20';
    } else {
      badgeText.textContent = 'ACTIVE';
      badgeContainer.className = 'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-cyan-950/40 text-cyan-400 border-cyan-500/20';
    }
  }
}
