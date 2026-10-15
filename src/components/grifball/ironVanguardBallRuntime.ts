import * as THREE from "three";
import type { GrifballRuntimeState } from "./runtimeState";
import type { GrifballThreeRefs } from "./threeRefs";
import { isIronVanguardModel } from "../iron-vanguard/ironVanguardModel";
import { animateVanguardBallView } from "../iron-vanguard/ironVanguardSwordView";
import {
  VANGUARD_BALL_THROW_DURATION,
  VANGUARD_BALL_HANDOFF_START,
  VANGUARD_BALL_HANDOFF_END,
} from "../iron-vanguard/ironVanguardBall";

type BallVisual = {
  holder: string | null;
  charge?: number;
  release?: { id: string; time: number; charge: number; offset: THREE.Vector3 };
};
const bodies = (state: GrifballRuntimeState, refs: GrifballThreeRefs): [string, THREE.Group][] => [
  ...(refs.hostGroup
    ? [[state.multiplayerRole === "observer" ? state.hostClientId ?? "player" : "player", refs.hostGroup] as [string, THREE.Group]]
    : []),
  ...Array.from(
    refs.otherPlayerMeshes,
    ([id, meshes]) => [id, meshes.group] as [string, THREE.Group],
  ),
  ...(refs.enemyGroup
    ? [[state.multiplayerRole === "observer" ? state.clientClientId ?? "main_ai" : "main_ai", refs.enemyGroup] as [string, THREE.Group]]
    : []),
];

/** Capture authoritative possession before skeleton sampling; never infer a throw from death/drop. */
export function prepareIronVanguardBallVisuals(
  state: GrifballRuntimeState,
  refs: GrifballThreeRefs,
  mesh: THREE.Mesh | null,
  dt: number,
) {
  if (!mesh) return;
  const ball = state.grifball.ball;
  const visual: BallVisual = (mesh.userData.ironVanguardBallVisual ??= {
    holder: null,
  });
  const holder = ball.state === "held" ? ball.holderId : null;
  if (visual.release) visual.release.time += Math.max(0, dt);
  if (visual.holder && holder !== visual.holder && ball.state === "thrown") {
    visual.release = {
      id: visual.holder,
      time: 0,
      charge: visual.charge ?? 0,
      offset: mesh.position
        .clone()
        .sub(new THREE.Vector3(ball.pos.x, ball.pos.y, ball.pos.z)),
    };
    const previousBody = bodies(state, refs).find(([id]) => id === visual.holder)?.[1];
    const previousBall =
      visual.holder === "player" && !state.isObserverMode
        ? refs.playerSword?.userData.ironVanguard?.ball
        : previousBody?.userData.ironVanguard?.ball;
    if (previousBall)
      visual.release.offset
        .copy(previousBall.getWorldPosition(new THREE.Vector3()))
        .sub(new THREE.Vector3(ball.pos.x, ball.pos.y, ball.pos.z));
  }
  const event = state.onlineGrifball?.visualRelease;
  if (event) {
    visual.release = { id: event.actorId, time: event.age, charge: event.charge, offset: visual.release?.id === event.actorId ? visual.release.offset : new THREE.Vector3() };
    delete state.onlineGrifball!.visualRelease;
  }
  const release = visual.release;
  const owner =
    release?.id === "player" ? null : state.otherPlayers.get(release?.id ?? "");
  const hp = release?.id === "player" ? state.playerHP : (owner?.hp ?? 0);
  const weaponState =
    release?.id === "player"
      ? state.activeWeapon === "sword"
        ? state.pSwordState
        : state.activeWeapon === "pistol"
          ? state.pPistolState
          : state.pWeaponState
      : owner?.weaponState;
  if (
    release &&
    (release.time >= VANGUARD_BALL_THROW_DURATION ||
      hp <= 0 ||
      holder === release.id ||
      state.grifball.phase !== "playing" ||
      (weaponState && weaponState !== "ready"))
  )
    delete visual.release;
  visual.holder = holder;
  visual.charge =
    holder === "player"
      ? state.grifballPassCharge
      : (state.otherPlayers.get(holder ?? "")?.grifballPassCharge ?? 0);
  for (const [id, body] of bodies(state, refs)) {
    body.userData.vanguardBallCharge =
      id === "player"
        ? state.grifballPassCharge
        : (state.otherPlayers.get(id)?.grifballPassCharge ?? 0);
    body.userData.vanguardBallReleaseCharge = visual.release?.charge;
    body.userData.vanguardBallThrowTime =
      visual.release?.id === id ? visual.release.time : undefined;
  }
}

/** Run after skeletal animation so the rendered ball never trails the hand by a frame. */
export function finishIronVanguardBallVisuals(
  state: GrifballRuntimeState,
  refs: GrifballThreeRefs,
  mesh: THREE.Mesh | null,
  dt: number,
) {
  const visual = mesh?.userData.ironVanguardBallVisual as
    | BallVisual
    | undefined;
  const held =
    state.grifball.ball.state === "held" ? state.grifball.ball.holderId : null;
  const view = refs.playerSword;
  const local =
    !state.isObserverMode &&
    state.playerHP > 0 &&
    (held === "player" || visual?.release?.id === "player");
  if (!local && view?.userData.vanguardBallViewActive) {
    view.visible = false;
    view.userData.vanguardBallViewActive = false;
  }
  if (view?.userData.ironVanguardSwordView && local) {
    view.visible = true;
    animateVanguardBallView(view, {
      dt,
      weaponState: state.pWeaponState,
      weaponTimer: state.pWeaponTimer,
      ballCharge: state.grifballPassCharge,
      ballReleaseCharge: visual?.release?.charge,
      ballThrowTime:
        visual?.release?.id === "player" ? visual.release.time : undefined,
      settings: state.settings,
    });
    if (refs.playerHammer) refs.playerHammer.visible = false;
    if (refs.playerPistol) refs.playerPistol.visible = false;
  }
  for (const [id, body] of bodies(state, refs)) {
    if (held !== id && body.userData.ironVanguard?.ball)
      body.userData.ironVanguard.ball.visible = false;
    if (!isIronVanguardModel(body) || visual?.release?.id !== id) continue;
    body.userData.ironVanguard.hammer.visible = false;
    const rig =
      body === refs.hostGroup
        ? { sword: refs.hostSword, pistol: undefined }
        : body === refs.enemyGroup
          ? { sword: refs.enemySword, pistol: undefined }
          : refs.otherPlayerMeshes.get(id);
    if (rig?.sword) rig.sword.visible = false;
    if (rig?.pistol) rig.pistol.visible = false;
  }
  if (!mesh) return;
  const body = held ? bodies(state, refs).find(([id]) => id === held)?.[1] : undefined;
  const prop =
    held === "player" && local
      ? view?.userData.ironVanguard?.ball
      : body?.userData.ironVanguard?.ball;
  if (
    prop?.visible &&
    ((held === "player" && local) || isIronVanguardModel(body))
  ) {
    mesh.position.copy(prop.getWorldPosition(new THREE.Vector3()));
    mesh.quaternion.copy(prop.getWorldQuaternion(new THREE.Quaternion()));
    // Spectated first-person bodies are hidden; their ball remains visible in world space.
    mesh.visible = held === "player" && local ? false : !body?.visible;
  } else if (visual?.release && state.grifball.ball.state === "thrown") {
    const fade =
      1 -
      THREE.MathUtils.smoothstep(
        visual.release.time,
        VANGUARD_BALL_HANDOFF_START,
        VANGUARD_BALL_HANDOFF_END,
      );
    const releaseBody = bodies(state, refs).find(
      ([id]) => id === visual.release!.id,
    )?.[1];
    const releaseProp =
      visual.release.id === "player" && !state.isObserverMode
        ? view?.userData.ironVanguard?.ball
        : releaseBody?.userData.ironVanguard?.ball;
    if (releaseProp) {
      mesh.position.lerp(
        releaseProp.getWorldPosition(new THREE.Vector3()),
        fade,
      );
      mesh.quaternion.slerp(releaseProp.getWorldQuaternion(new THREE.Quaternion()), fade);
    } else mesh.position.addScaledVector(visual.release.offset, fade);
  }
}
