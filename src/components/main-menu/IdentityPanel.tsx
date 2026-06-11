interface IdentityPanelProps {
  playerName: string;
  onPlayerNameChange: (name: string) => void;
}

export function IdentityPanel({
  playerName,
  onPlayerNameChange,
}: IdentityPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto pr-1 gap-4 max-w-2xl">
      <div className="bg-white/5 border border-white/5 rounded-lg p-3">
        <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block mb-2">Spartan Nickname Handle</span>
        <div className="relative">
          <input
            type="text"
            maxLength={10}
            value={playerName}
            onChange={(event) => onPlayerNameChange(event.target.value)}
            placeholder="Max 10 characters..."
            className="w-full h-11 bg-black/60 border border-white/10 rounded px-3.5 text-sm tracking-wide text-white focus:border-[#38bdf8] outline-none transition-all font-sans"
          />
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
