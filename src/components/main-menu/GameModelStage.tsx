import React, { useEffect, useState } from 'react';
import type { CharacterLoadout } from '../VoxelModels';
import { CharacterPreview } from '../CharacterPreview';
import { isIronVanguardLoadout, preloadIronVanguard } from '../iron-vanguard/ironVanguardModel';
import { preloadVanguardSword } from '../iron-vanguard/ironVanguardSword';

const VANGUARD_LOADOUT: CharacterLoadout = { characterAsset: 'iron-vanguard', modelSystem: 'v3', modelType: 'medium' };

export interface GameModelStageProps {
  hue?: number;
  heldWeapon?: 'none' | 'hammer' | 'sword';
  loadout?: CharacterLoadout;
  active?: boolean;
  className?: string;
  label?: string;
}

/** Renders the same model factory and assets as gameplay, never a substitute model. */
export function GameModelStage({ hue = 200, heldWeapon = 'hammer', loadout = VANGUARD_LOADOUT, active = true, className = '', label }: GameModelStageProps) {
  const isVanguard = isIronVanguardLoadout(loadout);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [rotation, setRotation] = useState(0.22);
  const [assetKey, setAssetKey] = useState('');
  const requestedAssetKey = `${isVanguard}:${heldWeapon}`;
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setStatus('loading');
    const preload = isVanguard
      ? Promise.all([preloadIronVanguard(), ...(heldWeapon === 'sword' ? [preloadVanguardSword()] : [])])
      : Promise.resolve();
    preload.then(() => {
      if (!disposed) { setAssetKey(requestedAssetKey); setStatus('ready'); }
    }).catch(() => { if (!disposed) setStatus('error'); });
    return () => { disposed = true; };
  }, [active, isVanguard, heldWeapon, attempt, requestedAssetKey]);
  const ready = active && status === 'ready' && assetKey === requestedAssetKey;
  return <section className={`game-model-stage ${className}`} aria-label={label ?? (isVanguard ? 'Iron Vanguard character preview' : 'Equipped character preview')}>
    <header className="game-model-stage__heading"><span>{isVanguard ? 'VERSION 3' : 'YOUR LOADOUT'}</span><strong>{isVanguard ? 'Iron Vanguard' : 'Standard character'}</strong></header>
    <div className="game-model-stage__viewport">
      {ready ? <CharacterPreview key={`${isVanguard}:${attempt}`} hue={hue} heldWeapon={heldWeapon} loadout={loadout} autoRotate={false} rotation={rotation} onRotationChange={setRotation} onError={() => setStatus('error')} /> : <>
        {isVanguard && <img className="game-model-stage__fallback" src="/assets/menu/iron-vanguard-reference.png" alt="Iron Vanguard V3 game model reference" />}
        <div className="game-model-stage__status" role="status"><strong>{status === 'error' ? 'Preview unavailable' : active ? 'Loading game model…' : 'Preview paused'}</strong><span>{status === 'error' ? 'Your selected appearance is saved. Retry the live preview.' : isVanguard ? 'Actual game asset · Static reference' : 'Preparing your selected loadout'}</span>{status === 'error' && <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry preview</button>}</div>
      </>}
    </div>
    <div className="game-model-stage__controls"><div aria-label="Model rotation"><button type="button" aria-label="Rotate model left" disabled={!ready} onClick={() => setRotation(value => value - Math.PI / 12)}>↶</button><button type="button" disabled={!ready} onClick={() => setRotation(0.22)}>Reset view</button><button type="button" aria-label="Rotate model right" disabled={!ready} onClick={() => setRotation(value => value + Math.PI / 12)}>↷</button></div><span>Drag to rotate</span></div>
  </section>;
}
