import { StrictMode, useEffect, useState, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Shield } from 'lucide-react';
import { ArmorModelEditor } from './components/main-menu/ArmorModelEditor';
import {
  PLAYER_LOADOUT_STORAGE_KEY,
  loadStoredPlayerLoadout,
} from './components/main-menu/useCustomizationState';
import {
  loadCustomArmorCatalog,
  persistCustomArmorCatalog,
  type CustomArmorCatalog,
} from './components/customArmor';
import type { CharacterLoadout } from './components/VoxelModels';
import { getSavedPlayerHue } from './settings/usePlayerSettings';
import './index.css';

const PLAYER_HUE_STORAGE_KEY = 'grifball_player_hue';

function persistPlayerLoadout(loadout: CharacterLoadout) {
  try {
    localStorage.setItem(PLAYER_LOADOUT_STORAGE_KEY, JSON.stringify(loadout));
  } catch {
    // Local persistence is best effort; the editor state still updates.
  }
}

function persistPlayerHue(hue: number) {
  try {
    localStorage.setItem(PLAYER_HUE_STORAGE_KEY, hue.toString());
  } catch {
    // Local persistence is best effort; the editor state still updates.
  }
}

function ArmorModelEditorPage() {
  const [playerLoadout, setPlayerLoadout] = useState<CharacterLoadout>(() => ({
    ...loadStoredPlayerLoadout(),
    modelSystem: 'v2',
  }));
  const [customArmorCatalog, setCustomArmorCatalog] = useState<CustomArmorCatalog>(() => loadCustomArmorCatalog());
  const [playerHue, setPlayerHue] = useState(() => getSavedPlayerHue());

  useEffect(() => {
    persistPlayerLoadout(playerLoadout);
  }, [playerLoadout]);

  useEffect(() => {
    persistCustomArmorCatalog(customArmorCatalog);
  }, [customArmorCatalog]);

  useEffect(() => {
    persistPlayerHue(playerHue);
  }, [playerHue]);

  const updateLoadout = (patch: Partial<CharacterLoadout>) => {
    setPlayerLoadout((previous) => {
      const next = {
        ...previous,
        ...patch,
        modelSystem: patch.modelSystem ?? previous.modelSystem ?? 'v2',
      };
      persistPlayerLoadout(next);
      return next;
    });
  };

  const updateCustomArmorCatalog = (update: SetStateAction<CustomArmorCatalog>) => {
    setCustomArmorCatalog((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      persistCustomArmorCatalog(next);
      return next;
    });
  };

  const customPieceCount = customArmorCatalog.pieces.length;
  const equippedCount = Object.keys(playerLoadout.customArmor ?? {}).length;

  return (
    <main className="h-dvh w-screen overflow-hidden bg-[#050b1a] text-white">
      <div className="flex h-full flex-col gap-4 p-5">
        <header className="shrink-0 rounded-2xl border border-white/10 bg-slate-900/55 px-5 py-4 shadow-2xl backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-purple-400/45 bg-purple-500/15 text-purple-100 shadow-[0_0_24px_rgba(168,85,247,0.18)]">
                <Shield className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="font-display text-2xl font-black uppercase tracking-wider text-white">
                  V2 Armor Model Editor
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest text-white/45">
                  <span>{customPieceCount} custom pieces</span>
                  <span className="text-white/20">/</span>
                  <span>{equippedCount} equipped</span>
                  <span className="text-white/20">/</span>
                  <span>Version 2 rig only</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex min-w-[260px] items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-cyan-300">Hue</span>
                <input
                  type="range"
                  min="0"
                  max="360"
                  value={playerHue}
                  onChange={(event) => setPlayerHue(parseInt(event.target.value, 10))}
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-gradient-to-r from-red-500 via-yellow-500 via-green-500 via-cyan-500 via-blue-500 via-purple-500 to-red-500 outline-none"
                />
                <span className="w-14 text-right font-mono text-[10px] font-black text-white/70">{playerHue} deg</span>
              </label>

              <a
                href="/"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 text-[10px] font-black uppercase tracking-widest text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-500/20"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Main Menu
              </a>
            </div>
          </div>
        </header>

        <section className="min-h-0 flex-1 rounded-2xl border border-white/10 bg-slate-900/45 p-4 shadow-2xl backdrop-blur-md">
          <ArmorModelEditor
            catalog={customArmorCatalog}
            playerLoadout={playerLoadout}
            playerHue={playerHue}
            onCatalogChange={updateCustomArmorCatalog}
            onLoadoutChange={updateLoadout}
            onClose={() => {
              window.location.href = '/';
            }}
            layout="standalone"
          />
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ArmorModelEditorPage />
  </StrictMode>,
);
