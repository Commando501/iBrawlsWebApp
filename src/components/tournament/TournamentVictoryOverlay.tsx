interface TournamentVictoryOverlayProps {
  opponentName: string;
  playerScore: number;
  opponentScore: number;
  onReturnToBracket: () => void;
}

export function TournamentVictoryOverlay({
  opponentName,
  playerScore,
  opponentScore,
  onReturnToBracket,
}: TournamentVictoryOverlayProps) {
  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-slate-950/85 backdrop-blur-md transition-all duration-300 p-4">
      <div className="relative bg-slate-900/60 border border-emerald-500/30 backdrop-blur-2xl rounded-2xl p-8 w-[450px] max-w-full shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col items-center text-center select-none overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="absolute -top-20 -left-20 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="w-16 h-16 rounded-full border border-emerald-500/30 flex items-center justify-center bg-emerald-950/40 shadow-[0_0_15px_rgba(52,211,153,0.2)] mb-5">
          <span className="text-3xl font-black leading-none">1</span>
        </div>

        <h2 className="text-3xl font-display font-black uppercase tracking-wider text-emerald-400 mb-2 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]">
          VICTORY DECLARED
        </h2>

        <p className="text-sm text-white/70 leading-relaxed max-w-sm mb-6 select-text">
          Outstanding performance, Spartan! You have successfully defeated <span className="text-emerald-400 font-bold uppercase">{opponentName}</span> and advanced on the bracket.
        </p>

        <div className="w-full bg-black/40 border border-white/5 rounded-xl p-4.5 flex justify-around items-center mb-8 shadow-inner select-none font-sans">
          <div className="text-center font-display">
            <p className="text-[10px] text-emerald-400 font-black uppercase tracking-widest font-mono">You</p>
            <p className="text-3xl font-black tracking-tight text-white">{playerScore}</p>
          </div>
          <div className="h-8 w-[1px] bg-white/10" />
          <div className="text-center font-display">
            <p className="text-[10px] text-white/40 font-black uppercase tracking-widest font-mono">Opponent</p>
            <p className="text-3xl font-black tracking-tight text-white/50">{opponentScore}</p>
          </div>
        </div>

        <button
          onClick={onReturnToBracket}
          className="w-full h-14 bg-gradient-to-b from-emerald-400 to-emerald-600 hover:from-emerald-300 hover:to-emerald-500 text-slate-950 font-sans font-black text-xs uppercase tracking-widest rounded transition-all active:scale-[0.98] cursor-pointer pointer-events-auto shadow-[0_0_15px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2"
        >
          <span>Return to Bracket & Prepare</span>
          <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
