import { observePlayerApproachSpeed, observePlayerPosition, type PlayerModel } from './aiPlayerModel';

interface ApproachSubject {
  id: string;
  pos: { x: number; z: number };
  vel: { x: number; z: number };
}

/** Engagement-boundary sampling: always sample the acting bot, and sample the
 * local player only when targeted. Other AI targets sample themselves on their
 * own turns. Position throttling and speed EMA remain owned by PlayerModel. */
export function recordAIEngagementApproachSamples(input: {
  bot: ApproachSubject;
  localPlayer: ApproachSubject | null;
  targetId: string;
  distanceToTarget: number;
  arenaRadius: number;
  nowSeconds: number;
  mapShape?: string;
  maxSpeed: number;
  record: (id: string, observe: (model: PlayerModel) => void) => void;
}): void {
  const sample = (subject: ApproachSubject) => input.record(subject.id, model => {
    observePlayerPosition(model, subject.pos.x, subject.pos.z, input.arenaRadius, input.nowSeconds, input.mapShape);
    if (input.distanceToTarget < 15)
      observePlayerApproachSpeed(model, Math.hypot(subject.vel.x, subject.vel.z), input.maxSpeed);
  });
  if (input.localPlayer?.id === input.targetId) sample(input.localPlayer);
  sample(input.bot);
}
