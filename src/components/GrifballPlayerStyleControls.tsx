import { GRIFBALL_PLAYER_STYLES, GRIFBALL_RUNNER_PREFERENCES, GRIFBALL_RUNNER_PATIENCE_PREFERENCES, GRIFBALL_DEFENSE_PREFERENCES, GRIFBALL_MARK_POSITION_PREFERENCES, GRIFBALL_PASS_PREFERENCES, GRIFBALL_PICKUP_PREFERENCES, GRIFBALL_PICKUP_SUPPORT_PREFERENCES, GRIFBALL_SAFETY_POSITION_PREFERENCES, GRIFBALL_TIPOFF_PREFERENCES, GRIFBALL_TIPOFF_POSITION_PREFERENCES, GRIFBALL_TIPOFF_RECOVERY_PREFERENCES, GRIFBALL_TIPOFF_SCREEN_PREFERENCES, GRIFBALL_TIPOFF_TARGET_PREFERENCES, GRIFBALL_TIPOFF_COMMITMENT_PREFERENCES, GRIFBALL_CLASH_PREFERENCES, GRIFBALL_SWORD_GUARD_PREFERENCES, GRIFBALL_HAMMER_DEFENSE_PREFERENCES, GRIFBALL_PASS_RECOVERY_PREFERENCES, GRIFBALL_PASS_SUPPORT_PREFERENCES, GRIFBALL_ESCORT_POSITION_PREFERENCES, GRIFBALL_ENGAGEMENT_PREFERENCES, GRIFBALL_DOUBLE_TEAM_PREFERENCES, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from '../game/grifballPlayerStyles';

export function GrifballPlayerStyleControls({ bots, styles, onChange }: {
  bots: { id: string; team: string }[];
  styles: Record<string, GrifballPlayerStyle>;
  onChange: (id: string, style: GrifballPlayerStyle) => void;
}) {
  return <section aria-label="Grifball player styles" className="space-y-3">
    <p className="text-xs text-slate-400">Player styles belong to individual roster bots and follow them across teams. Separate strengths control support engagements, carrier routes, defensive jobs, passing, punch-clash timing, sword defense, hammer pass defense, pass recovery, landing support, escort positions, double-team decisions, engagement persistence, runner patience, marking positions, loose-ball recovery, pickup support, last-defender positions and tip-off decisions, lanes, recovery, screen selection, target selection and target commitment. Tune tip-off individuality in the Tip-off tab. Combat personalities and difficulty are separate.</p>
    {!bots.length && <p className="text-xs text-cyan-200">Start an offline Grifball match to assign player styles to active scripted bots.</p>}
    {bots.map(bot => {
      const style = resolveGrifballPlayerStyle(styles, bot.id);
      return <label key={bot.id} className="block text-sm space-y-1">
        <span className="flex items-center justify-between gap-2"><span>{bot.id} · {bot.team}</span>
          <select aria-label={`Grifball style for ${bot.id}`} className="min-w-0 rounded border border-slate-600 bg-slate-950 px-2 py-2" value={style}
            onChange={e => onChange(bot.id, e.target.value as GrifballPlayerStyle)}>
            {Object.entries(GRIFBALL_PLAYER_STYLES).map(([id, profile]) => <option key={id} value={id}>{profile.label}</option>)}
          </select>
        </span>
        <span className="block text-xs text-slate-400">Support: {GRIFBALL_PLAYER_STYLES[style].description}</span>
        <span className="block text-xs text-slate-400">Runner: {GRIFBALL_RUNNER_PREFERENCES[style]}</span>
        <span className="block text-xs text-slate-400">Runner patience: {GRIFBALL_RUNNER_PATIENCE_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Marking position: {GRIFBALL_MARK_POSITION_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Defense: {GRIFBALL_DEFENSE_PREFERENCES[style]}</span>
        <span className="block text-xs text-slate-400">Loose-ball recovery: {GRIFBALL_PICKUP_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Pickup support: {GRIFBALL_PICKUP_SUPPORT_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Tip-off target commitment: {GRIFBALL_TIPOFF_COMMITMENT_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Tip-off target: {GRIFBALL_TIPOFF_TARGET_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Tip-off screen: {GRIFBALL_TIPOFF_SCREEN_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Tip-off recovery: {GRIFBALL_TIPOFF_RECOVERY_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Tip-off lane: {GRIFBALL_TIPOFF_POSITION_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Tip-off: {GRIFBALL_TIPOFF_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Last defender: {GRIFBALL_SAFETY_POSITION_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Passing: {GRIFBALL_PASS_PREFERENCES[style]}</span>
        <span className="block text-xs text-slate-400">Counter: {GRIFBALL_CLASH_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Sword defense: {GRIFBALL_SWORD_GUARD_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Hammer defense: {GRIFBALL_HAMMER_DEFENSE_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Engagement persistence: {GRIFBALL_ENGAGEMENT_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Double team: {GRIFBALL_DOUBLE_TEAM_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Escort position: {GRIFBALL_ESCORT_POSITION_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Pass landing support: {GRIFBALL_PASS_SUPPORT_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Pass recovery: {GRIFBALL_PASS_RECOVERY_PREFERENCES[style].reason}</span>
      </label>;
    })}
  </section>;
}
