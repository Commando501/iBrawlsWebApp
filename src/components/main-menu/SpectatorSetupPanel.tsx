interface SpectatorSetupPanelProps {
  onSpectateLiveMatch: () => void;
}

export function SpectatorSetupPanel({
  onSpectateLiveMatch,
}: SpectatorSetupPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="bg-slate-950/45 border border-white/10 rounded-xl p-5 flex flex-col gap-3 shadow-[inset_0_1px_3px_rgba(0,0,0,0.30)]">
        <span className="text-[10px] font-mono font-bold tracking-[0.4em] uppercase text-[#22d3ee]">OBSERVER MODE</span>
        <h2
          className="text-2xl font-display font-black italic uppercase tracking-tight"
          style={{
            background: 'linear-gradient(90deg,#22d3ee,#fff,#a5b4fc)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            color: 'transparent',
            lineHeight: 1,
          }}
        >
          FLIGHT ENGINE
        </h2>
        <p className="text-sm text-white/65 leading-relaxed">
          Camera-only access. Maneuver between active brawlers with <code className="bg-[#22d3ee]/10 border border-[#22d3ee]/25 text-[#22d3ee] px-1.5 py-0.5 rounded text-xs font-mono">[W][A][S][D]</code>, rise with <code className="bg-[#22d3ee]/10 border border-[#22d3ee]/25 text-[#22d3ee] px-1.5 py-0.5 rounded text-xs font-mono">[SPACE]</code>, and cycle targets with the spectator target controls.
        </p>
      </div>
      <button
        onClick={onSpectateLiveMatch}
        className="w-full h-14 bg-[#22d3ee]/12 border border-[#22d3ee]/45 rounded text-[#22d3ee] font-sans font-black text-sm italic uppercase tracking-wider cursor-pointer shadow-[0_0_18px_rgba(34,211,238,0.25)] hover:bg-[#22d3ee]/20 transition-all"
      >
        Spectate Live Match
      </button>
      <div className="bg-white/4 border border-white/5 rounded-lg p-3">
        <span className="text-[9px] font-mono text-[#a5b4fc] uppercase tracking-widest">MANEUVER OVERRIDE SYSTEMS</span>
        <p className="text-xs text-white/65 mt-1 leading-relaxed">
          Join an active multiplayer session as an observer. You cannot interact with the match; watch and analyze brawl patterns.
        </p>
      </div>
    </div>
  );
}
