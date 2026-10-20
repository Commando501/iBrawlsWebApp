import { GRIFBALL_PLAYER_STYLES, GRIFBALL_RUNNER_PREFERENCES, GRIFBALL_DEFENSE_PREFERENCES, GRIFBALL_PASS_PREFERENCES, GRIFBALL_CLASH_PREFERENCES, GRIFBALL_SWORD_GUARD_PREFERENCES, GRIFBALL_HAMMER_DEFENSE_PREFERENCES, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from '../game/grifballPlayerStyles';

export function GrifballPlayerStyleControls({ bots, styles, onChange }: {
  bots: { id: string; team: string }[];
  styles: Record<string, GrifballPlayerStyle>;
  onChange: (id: string, style: GrifballPlayerStyle) => void;
}) {
  return <section aria-label="Grifball player styles" className="space-y-3">
    <p className="text-xs text-slate-400">Player styles belong to individual roster bots and follow them across teams. Separate strengths control support engagements, carrier routes, defensive jobs, passing, punch-clash timing, sword defense and hammer pass defense. Combat personalities and difficulty are separate.</p>
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
        <span className="block text-xs text-slate-400">Defense: {GRIFBALL_DEFENSE_PREFERENCES[style]}</span>
        <span className="block text-xs text-slate-400">Passing: {GRIFBALL_PASS_PREFERENCES[style]}</span>
        <span className="block text-xs text-slate-400">Counter: {GRIFBALL_CLASH_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Sword defense: {GRIFBALL_SWORD_GUARD_PREFERENCES[style].reason}</span>
        <span className="block text-xs text-slate-400">Hammer defense: {GRIFBALL_HAMMER_DEFENSE_PREFERENCES[style].reason}</span>
      </label>;
    })}
  </section>;
}
