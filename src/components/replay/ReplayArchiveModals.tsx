interface ReplayEditModalProps {
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onUpdate: () => void | Promise<void>;
  onClose: () => void;
}

interface ReplaySaveCachedModalProps {
  name: string;
  description: string;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onCommit: () => void | Promise<void>;
  onClose: () => void;
}

export function ReplayEditModal({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onUpdate,
  onClose,
}: ReplayEditModalProps) {
  const canSubmit = name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none animate-in fade-in duration-200">
      <div className="mobile-modal w-full max-w-md bg-slate-900 border border-pink-500/25 rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-left max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-white/5 pb-4 shrink-0">
          <div className="flex flex-col">
            <span className="text-[10px] text-pink-500 font-bold uppercase tracking-[0.2em] mb-1 font-display">ARCHIVE METADATA</span>
            <h3 className="text-lg font-black tracking-tight text-white uppercase font-display">Rename Replay Record</h3>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white font-bold cursor-pointer p-1"
          >
            âœ•
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold">Record Custom Title:</label>
            <input
              type="text"
              maxLength={40}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="E.g., Sandbox Dominance..."
              className="w-full h-11 bg-black/60 border border-white/10 rounded px-3 text-sm tracking-wide text-white focus:border-pink-500 outline-none transition-all font-semibold"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold">Record Description / Commentary:</label>
            <textarea
              maxLength={200}
              rows={4}
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="E.g., Highlight of the triple-kill sword lunge at the buzzer..."
              className="w-full bg-black/60 border border-white/10 rounded p-3 text-sm tracking-wide text-white focus:border-pink-500 outline-none transition-all font-medium resize-none leading-relaxed"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-2 shrink-0">
          <button
            onClick={async () => {
              if (canSubmit) {
                await onUpdate();
              }
            }}
            disabled={!canSubmit}
            className={`flex-1 py-3 font-sans font-black text-xs uppercase tracking-widest rounded-lg transition-all border outline-none cursor-pointer flex items-center justify-center gap-1.5 shadow-lg ${
              canSubmit
                ? 'bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white border-pink-500/20 active:scale-95 shadow-[0_0_12px_rgba(236,72,153,0.3)]'
                : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
            }`}
          >
            ðŸ’¾ Update Record
          </button>
          <button
            onClick={onClose}
            className="px-5 py-3 bg-white/5 hover:bg-white/10 text-xs text-white/70 hover:text-white uppercase font-black tracking-widest transition-all rounded-lg border border-white/10 cursor-pointer active:scale-95"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReplaySaveCachedModal({
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onCommit,
  onClose,
}: ReplaySaveCachedModalProps) {
  const canSubmit = name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-xl p-4 select-none animate-in fade-in duration-200">
      <div className="mobile-modal w-full max-w-md bg-slate-900 border border-yellow-500/25 rounded-2xl p-6 shadow-2xl flex flex-col gap-5 text-left max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex justify-between items-center border-b border-white/5 pb-4 shrink-0">
          <div className="flex flex-col">
            <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-[0.2em] mb-1 font-display">ARCHIVE ACQUISITION</span>
            <h3 className="text-lg font-black tracking-tight text-white uppercase font-display">Commit Replay to Archives</h3>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white font-bold cursor-pointer p-1"
          >
            âœ•
          </button>
        </div>

        <p className="text-[11.5px] text-white/60 leading-relaxed bg-yellow-500/5 border border-yellow-500/10 p-3 rounded">
          âš ï¸ This will save the rolling auto-save match cache item permanently into your Archives, ensuring it won't be overwritten. Add a name and description to find it easily!
        </p>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold">Archive Record Title:</label>
            <input
              type="text"
              maxLength={40}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Give this replay record a name..."
              className="w-full h-11 bg-black/60 border border-white/10 rounded px-3 text-sm tracking-wide text-white focus:border-yellow-500 outline-none transition-all font-semibold"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] text-white/40 uppercase tracking-widest font-mono font-bold">Replay Summary / Notes:</label>
            <textarea
              maxLength={200}
              rows={4}
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Record highlight notes, bots behavior details, scores, etc..."
              className="w-full bg-black/60 border border-white/10 rounded p-3 text-sm tracking-wide text-white focus:border-yellow-500 outline-none transition-all font-medium resize-none leading-relaxed"
            />
          </div>
        </div>

        <div className="flex gap-3 mt-2 shrink-0">
          <button
            onClick={async () => {
              if (canSubmit) {
                await onCommit();
              }
            }}
            disabled={!canSubmit}
            className={`flex-1 py-3 font-sans font-black text-xs uppercase tracking-widest rounded-lg transition-all border outline-none cursor-pointer flex items-center justify-center gap-1.5 shadow-lg ${
              canSubmit
                ? 'bg-gradient-to-r from-yellow-600 to-amber-600 hover:from-yellow-500 hover:to-amber-500 text-white border-yellow-500/20 active:scale-95 shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
            }`}
          >
            ðŸ“¥ Commit to Archives
          </button>
          <button
            onClick={onClose}
            className="px-5 py-3 bg-white/5 hover:bg-white/10 text-xs text-white/70 hover:text-white uppercase font-black tracking-widest transition-all rounded-lg border border-white/10 cursor-pointer active:scale-95"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
