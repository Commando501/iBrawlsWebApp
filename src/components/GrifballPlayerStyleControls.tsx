import { GRIFBALL_PLAYER_STYLES, resolveGrifballPlayerStyle, type GrifballPlayerStyle } from '../game/grifballPlayerStyles';

export function GrifballPlayerStyleControls({ bots, styles, onChange }: {
  bots: { id: string; team: string }[];
  styles: Record<string, GrifballPlayerStyle>;
  onChange: (id: string, style: GrifballPlayerStyle) => void;
}) {
  return <section aria-label="Grifball player styles" className="space-y-3">
    <p className="text-xs text-slate-400">Player styles belong to individual roster bots and follow them across teams. They are separate from combat personalities and difficulty. This first version affects support engagements while your team has the ball.</p>
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
        <span className="block text-xs text-slate-400">{GRIFBALL_PLAYER_STYLES[style].description}</span>
      </label>;
    })}
  </section>;
}
