import type { SaveSystemStatus } from '../../settings/useSaveAccountSync';

interface SaveCodesPanelProps {
  saveSystemStatus: SaveSystemStatus;
  saveCodeImportInput: string;
  onExportSaveCode: () => void;
  onResetAllSettings: () => void;
  onSaveCodeImportInputChange: (value: string) => void;
  onImportSaveCode: (value: string) => void;
}

export function SaveCodesPanel({
  saveSystemStatus,
  saveCodeImportInput,
  onExportSaveCode,
  onResetAllSettings,
  onSaveCodeImportInputChange,
  onImportSaveCode,
}: SaveCodesPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto pr-1 gap-4 max-w-2xl">
      <div className="bg-white/5 border border-white/5 rounded-lg p-3 flex flex-col gap-2.5">
        <div className="flex justify-between items-center border-b border-white/5 pb-2">
          <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5">
            Neural Backup System
          </span>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded flex items-center gap-1.5 shrink-0 select-none animate-pulse">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full inline-block" />
            LOCAL_COOKIE_ACTIVE
          </span>
        </div>

        <p className="text-xs text-white/50 leading-normal">
          All configs, layouts, colors, and Spartan handles are synced locally. Export a decryption code to share or migrate your profile!
        </p>

        {saveSystemStatus.type && (
          <div className={`p-2.5 rounded text-xs font-mono border ${
            saveSystemStatus.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {saveSystemStatus.message}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onExportSaveCode}
            className="flex-1 py-2 bg-[#38bdf8]/15 hover:bg-[#38bdf8]/30 border border-[#38bdf8]/30 text-[#38bdf8] font-bold text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.98]"
          >
            Export Save Code
          </button>
          <button
            type="button"
            onClick={onResetAllSettings}
            className="py-2 px-3.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 font-bold text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.98]"
            title="Wipe client database"
          >
            Wipe Saves
          </button>
        </div>

        <div className="flex flex-col gap-1.5 mt-1 border-t border-white/5 pt-2.5">
          <span className="text-[10px] text-white/30 uppercase tracking-widest font-mono">Import Cybernetic Code:</span>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={saveCodeImportInput}
              onChange={(event) => onSaveCodeImportInputChange(event.target.value)}
              placeholder="Paste GRIF-DEC- code here..."
              className="flex-1 h-10 bg-black/60 border border-white/10 rounded px-3 font-mono text-xs text-white placeholder:text-white/20 focus:border-[#38bdf8] outline-none transition-all"
            />
            <button
              type="button"
              onClick={() => onImportSaveCode(saveCodeImportInput)}
              disabled={!saveCodeImportInput}
              className={`px-4 h-10 font-sans font-bold text-xs uppercase tracking-wider rounded transition-all border outline-none ${
                saveCodeImportInput
                  ? 'bg-emerald-500/15 hover:bg-emerald-500/35 border-emerald-500/40 text-emerald-400 cursor-pointer'
                  : 'bg-white/5 border-white/5 text-white/20 cursor-not-allowed'
              }`}
            >
              Decrypt
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
