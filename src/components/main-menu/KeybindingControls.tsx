import React from 'react';
import type { Keybindings } from '../../types';

interface KbVisualizerProps {
  bindings: Keybindings;
  rebinding: keyof Keybindings | null;
  onPick: (action: keyof Keybindings) => void;
}

const ACTION_LABELS: Record<string, string> = {
  moveForward: 'FWD', moveLeft: 'LEFT', moveBackward: 'BACK', moveRight: 'RIGHT',
  jump: 'JUMP', dash: 'THRUST', pickup: 'PICKUP', crouch: 'CROUCH', sprint: 'SPRINT', scoreboard: 'SCORE',
  weapon1: 'HAMMER', weapon2: 'SWORD', attack: 'ATTACK', altAttack: 'ALT-ATK',
};

function KbBindRow({ label, action, bindings, rebinding, onPick }: {
  label: string; action: keyof Keybindings; bindings: Keybindings; rebinding: keyof Keybindings | null; onPick: (a: keyof Keybindings) => void;
}) {
  const isActive = rebinding === action;
  const val = bindings[action];
  const display = (val === ' ' ? 'Space' : (val || '—')).toString().toUpperCase();
  return (
    <button onClick={() => onPick(action)} style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 10px', borderRadius: 4, cursor: 'pointer', width: '100%',
      background: isActive ? 'rgba(245,158,11,0.15)' : 'rgba(0,0,0,0.35)',
      border: isActive ? '1px solid rgba(245,158,11,0.55)' : '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 900,
        color: isActive ? '#fbbf24' : '#22d3ee',
        background: isActive ? 'rgba(245,158,11,0.10)' : 'rgba(34,211,238,0.10)',
        border: isActive ? '1px solid rgba(245,158,11,0.40)' : '1px solid rgba(34,211,238,0.30)',
        padding: '2px 8px', borderRadius: 3, letterSpacing: '0.05em', minWidth: 42, textAlign: 'center' as const,
      }}>
        {isActive ? '…' : `[${display}]`}
      </span>
    </button>
  );
}

export const getGamepadButtonName = (idx: number | undefined): string => {
  if (idx === undefined) return 'UNBOUND';
  const names: Record<number, string> = {
    0: 'A',
    1: 'B',
    2: 'X',
    3: 'Y',
    4: 'LB',
    5: 'RB',
    6: 'LT',
    7: 'RT',
    8: 'Back',
    9: 'Start',
    10: 'LS Click',
    11: 'RS Click',
    12: 'D-Pad Up',
    13: 'D-Pad Down',
    14: 'D-Pad Left',
    15: 'D-Pad Right',
    16: 'Guide'
  };
  return names[idx] ?? `Btn ${idx}`;
};

export function KeyboardVisualizer({ bindings, rebinding, onPick }: KbVisualizerProps) {
  const boundLookup: Record<string, keyof Keybindings> = {};
  for (const [action, key] of Object.entries(bindings)) {
    if (typeof key === 'string') boundLookup[key] = action as keyof Keybindings;
  }

  const KS = 32;
  const KG = 4;
  const FKH = 28;

  const mkKey = (val: string | null, label: string, w: number = KS, h: number = KS, locked: boolean = false) => {
    const action = val ? boundLookup[val] : undefined;
    const isActive = !!action && rebinding === action;
    const isBound = !!action && !locked;
    const subLbl = action ? ACTION_LABELS[action] : '';
    return (
      <button
        onClick={() => action && !locked && onPick(action)}
        disabled={!action || locked}
        style={{
          width: w, height: h, minWidth: w, minHeight: h, flexShrink: 0,
          borderRadius: 5, padding: 0, cursor: (action && !locked) ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' as const,
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 800, fontSize: 13,
          lineHeight: 1, letterSpacing: '0.02em', transition: 'all 150ms',
          background: isActive ? 'rgba(245,158,11,0.30)' : isBound ? 'rgba(34,211,238,0.18)' : locked ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.55)',
          border: isActive ? '1px solid rgba(245,158,11,0.7)' : isBound ? '1px solid rgba(34,211,238,0.55)' : locked ? '1px solid rgba(255,255,255,0.04)' : '1px solid rgba(255,255,255,0.08)',
          color: isActive ? '#fbbf24' : isBound ? '#22d3ee' : locked ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.38)',
          boxShadow: isBound ? '0 0 5px rgba(34,211,238,0.18)' : 'none',
        }}
      >
        <span style={{ lineHeight: 1 }}>{label}</span>
        {subLbl && (
          <span style={{ fontSize: 11, fontWeight: 800, opacity: 0.95, letterSpacing: '0.03em', marginTop: 3, lineHeight: 1, color: isActive ? '#fde68a' : '#67e8f9' }}>
            {subLbl}
          </span>
        )}
      </button>
    );
  };

  const R = (children: React.ReactNode) => (
    <div style={{ display: 'flex', gap: KG }}>{children}</div>
  );

  const attackBoundToLmb = bindings.attack === 'lmb';
  const altAttackBoundToRmb = bindings.altAttack === 'rmb';

  return (
    <div style={{ background: 'rgba(2,6,23,0.45)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 18, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10, marginBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.05)', gap: 8, flexWrap: 'wrap' as const }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#38bdf8', whiteSpace: 'nowrap' as const }}>
          ⌨ Keyboard + Mouse Layout
        </span>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: rebinding ? '#fbbf24' : 'rgba(255,255,255,0.40)', background: rebinding ? 'rgba(245,158,11,0.10)' : 'rgba(255,255,255,0.05)', border: rebinding ? '1px solid rgba(245,158,11,0.30)' : '1px solid rgba(255,255,255,0.10)', padding: '2px 8px', borderRadius: 4, letterSpacing: '0.15em', textTransform: 'uppercase' as const }}>
          {rebinding ? 'PRESS ANY KEY…' : 'CLICK A KEY TO REBIND'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' as const }}>

        {/* ── Main keyboard block ── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: KG }}>

          {/* Function row */}
          {R(<>
            {mkKey(null, 'Esc', 42, KS, true)}
            <div style={{ width: 9 }} />
            {mkKey('f1', 'F1', KS, FKH)} {mkKey('f2', 'F2', KS, FKH)} {mkKey('f3', 'F3', KS, FKH)} {mkKey('f4', 'F4', KS, FKH)}
            <div style={{ width: 7 }} />
            {mkKey('f5', 'F5', KS, FKH)} {mkKey('f6', 'F6', KS, FKH)} {mkKey('f7', 'F7', KS, FKH)} {mkKey('f8', 'F8', KS, FKH)}
            <div style={{ width: 7 }} />
            {mkKey('f9', 'F9', KS, FKH)} {mkKey('f10', 'F10', KS, FKH)} {mkKey('f11', 'F11', KS, FKH)} {mkKey('f12', 'F12', KS, FKH)}
          </>)}

          {/* Number row */}
          {R(<>
            {mkKey('`', '`')} {mkKey('1', '1')} {mkKey('2', '2')} {mkKey('3', '3')} {mkKey('4', '4')}
            {mkKey('5', '5')} {mkKey('6', '6')} {mkKey('7', '7')} {mkKey('8', '8')} {mkKey('9', '9')}
            {mkKey('0', '0')} {mkKey('-', '-')} {mkKey('=', '=')}
            {mkKey('backspace', '⌫', KS * 2 + KG)}
          </>)}

          {/* QWERTY row */}
          {R(<>
            {mkKey(null, 'Tab', 50, KS, true)}
            {mkKey('q', 'Q')} {mkKey('w', 'W')} {mkKey('e', 'E')} {mkKey('r', 'R')} {mkKey('t', 'T')}
            {mkKey('y', 'Y')} {mkKey('u', 'U')} {mkKey('i', 'I')} {mkKey('o', 'O')} {mkKey('p', 'P')}
            {mkKey('[', '[')} {mkKey(']', ']')}
            {mkKey('\\', '\\', 50, KS)}
          </>)}

          {/* ASDF row */}
          {R(<>
            {mkKey(null, 'Caps', 59, KS, true)}
            {mkKey('a', 'A')} {mkKey('s', 'S')} {mkKey('d', 'D')} {mkKey('f', 'F')} {mkKey('g', 'G')}
            {mkKey('h', 'H')} {mkKey('j', 'J')} {mkKey('k', 'K')} {mkKey('l', 'L')}
            {mkKey(';', ';')} {mkKey("'", "'")}
            {mkKey('enter', '↵', 57, KS)}
          </>)}

          {/* ZXCV row */}
          {R(<>
            {mkKey('shift', '⇧', 57, KS)}
            {mkKey('z', 'Z')} {mkKey('x', 'X')} {mkKey('c', 'C')} {mkKey('v', 'V')} {mkKey('b', 'B')}
            {mkKey('n', 'N')} {mkKey('m', 'M')} {mkKey(',', ',')} {mkKey('.', '.')} {mkKey('/', '/')}
            {mkKey('shift', '⇧', 69, KS)}
          </>)}

          {/* Bottom row */}
          {R(<>
            {mkKey(null, 'Ctrl', 44, KS, true)}
            {mkKey(null, '❖', 28, KS, true)}
            {mkKey(null, 'Alt', 44, KS, true)}
            {mkKey(' ', 'Space', 214, KS)}
            {mkKey(null, 'Alt', 44, KS, true)}
            {mkKey(null, '☰', 28, KS, true)}
            {mkKey(null, 'Ctrl', 44, KS, true)}
          </>)}
        </div>

        {/* ── Nav cluster ── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: KG }}>
          <div style={{ height: FKH + KG }} />
          {R(<>{mkKey('insert', 'Ins', KS)} {mkKey('home', 'Hm', KS)} {mkKey('pageup', 'PgU', KS)}</>)}
          {R(<>{mkKey('delete', 'Del', KS)} {mkKey('end', 'End', KS)} {mkKey('pagedown', 'PgD', KS)}</>)}
          <div style={{ height: KS + KG }} />
          <div style={{ display: 'flex', gap: KG }}><div style={{ width: KS + KG }} />{mkKey('arrowup', '↑', KS)}</div>
          {R(<>{mkKey('arrowleft', '←', KS)} {mkKey('arrowdown', '↓', KS)} {mkKey('arrowright', '→', KS)}</>)}
        </div>

        {/* ── Numpad (CSS grid for tall + and Enter) ── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: KG }}>
          <div style={{ height: FKH + KG }} />
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(4, ${KS}px)`, gridTemplateRows: `repeat(5, ${KS}px)`, gap: KG }}>
            {mkKey('numlock', 'NmLk')}
            {mkKey('/', '/')}
            {mkKey('*', '*')}
            {mkKey('-', '-')}
            {mkKey('7', '7')}
            {mkKey('8', '8')}
            {mkKey('9', '9')}
            <div style={{ gridRow: 'span 2', display: 'flex' }}>
              {mkKey('+', '+', KS, KS * 2 + KG)}
            </div>
            {mkKey('4', '4')}
            {mkKey('5', '5')}
            {mkKey('6', '6')}
            {mkKey('1', '1')}
            {mkKey('2', '2')}
            {mkKey('3', '3')}
            <div style={{ gridRow: 'span 2', display: 'flex' }}>
              {mkKey('enter', '↵', KS, KS * 2 + KG)}
            </div>
            <div style={{ gridColumn: 'span 2', display: 'flex' }}>
              {mkKey('0', '0', KS * 2 + KG, KS)}
            </div>
            {mkKey('.', '.')}
          </div>
        </div>

        {/* ── Mouse ── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10, alignItems: 'center' }}>
          <div style={{ height: FKH + KG }} />
          <svg viewBox="0 0 80 110" style={{ width: 68, height: 94 }}>
            <path d="M 16 22 Q 16 8, 40 8 Q 64 8, 64 22 L 64 86 Q 64 102, 40 102 Q 16 102, 16 86 Z" fill="rgba(15,23,42,0.65)" stroke="rgba(255,255,255,0.20)" strokeWidth="1.5"/>
            <line x1="40" y1="8" x2="40" y2="44" stroke="rgba(255,255,255,0.15)" strokeWidth="1"/>
            <path d="M 16 22 Q 16 8, 40 8 L 40 44 L 16 44 Z"
              fill={rebinding === 'attack' ? 'rgba(245,158,11,0.35)' : attackBoundToLmb ? 'rgba(34,211,238,0.22)' : 'rgba(255,255,255,0.04)'}
              stroke={rebinding === 'attack' ? 'rgba(245,158,11,0.7)' : attackBoundToLmb ? 'rgba(34,211,238,0.55)' : 'rgba(255,255,255,0.12)'}
              strokeWidth="1" style={{ cursor: 'pointer' }} onClick={() => onPick('attack')} />
            <path d="M 40 8 Q 64 8, 64 22 L 64 44 L 40 44 Z"
              fill={rebinding === 'altAttack' ? 'rgba(245,158,11,0.35)' : altAttackBoundToRmb ? 'rgba(34,211,238,0.22)' : 'rgba(255,255,255,0.04)'}
              stroke={rebinding === 'altAttack' ? 'rgba(245,158,11,0.7)' : altAttackBoundToRmb ? 'rgba(34,211,238,0.55)' : 'rgba(255,255,255,0.12)'}
              strokeWidth="1" style={{ cursor: 'pointer' }} onClick={() => onPick('altAttack')} />
            <rect x="36" y="22" width="8" height="14" rx="3" fill="rgba(34,211,238,0.30)" stroke="rgba(34,211,238,0.7)" strokeWidth="1"/>
            <line x1="36" y1="28" x2="44" y2="28" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
            <line x1="36" y1="31" x2="44" y2="31" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5"/>
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 4 }}>
            {([
              { label: 'LMB', sub: 'ATTACK',  bk: 'attack' as keyof Keybindings,    isBound: attackBoundToLmb },
              { label: 'RMB', sub: 'ALT-ATK', bk: 'altAttack' as keyof Keybindings, isBound: altAttackBoundToRmb },
            ] as const).map(({ label, sub, bk, isBound }) => (
              <div key={bk} onClick={() => onPick(bk)} style={{
                cursor: 'pointer', padding: '6px 10px', borderRadius: 5,
                display: 'flex', flexDirection: 'column' as const, gap: 2,
                background: rebinding === bk ? 'rgba(245,158,11,0.20)' : isBound ? 'rgba(34,211,238,0.10)' : 'rgba(15,23,42,0.55)',
                border: rebinding === bk ? '1px solid rgba(245,158,11,0.5)' : isBound ? '1px solid rgba(34,211,238,0.30)' : '1px solid rgba(255,255,255,0.08)',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 800,
                color: rebinding === bk ? '#fbbf24' : isBound ? '#22d3ee' : 'rgba(255,255,255,0.38)', letterSpacing: '0.06em', lineHeight: 1,
              }}>
                <span style={{ fontSize: 15 }}>{label}</span>
                <span style={{ fontSize: 12, opacity: 0.78 }}>{sub}</span>
              </div>
            ))}
            <div style={{ padding: '6px 10px', borderRadius: 5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 800, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.06em', lineHeight: 1 }}>
              <span style={{ fontSize: 15, display: 'block', color: 'rgba(255,255,255,0.35)' }}>WHEEL</span>
              <span style={{ fontSize: 12, opacity: 0.72, display: 'block', marginTop: 3 }}>SWAP WEAP</span>
            </div>
          </div>
        </div>
      </div>

      {/* Compact chip grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <KbBindRow label="FWD"     action="moveForward"  bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="LEFT"    action="moveLeft"     bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="BACK"    action="moveBackward" bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="RIGHT"   action="moveRight"    bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="JUMP"    action="jump"         bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="THRUST"  action="dash"         bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="PICKUP"  action="pickup"       bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="CROUCH"  action="crouch"       bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="SPRINT"  action="sprint"       bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="SCORE"   action="scoreboard"   bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="HAMMER"  action="weapon1"      bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="SWORD"   action="weapon2"      bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="ATTACK"  action="attack"       bindings={bindings} rebinding={rebinding} onPick={onPick} />
        <KbBindRow label="ALT-ATK" action="altAttack"   bindings={bindings} rebinding={rebinding} onPick={onPick} />
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
const COMPACT_KEYBIND_SECTIONS: Array<{
  title: string;
  actions: Array<{ action: keyof Keybindings; label: string }>;
}> = [
  {
    title: 'Movement',
    actions: [
      { action: 'moveForward', label: 'Move Forward' },
      { action: 'moveLeft', label: 'Move Left' },
      { action: 'moveBackward', label: 'Move Backward' },
      { action: 'moveRight', label: 'Move Right' },
      { action: 'jump', label: 'Jump / Boost' },
      { action: 'dash', label: 'Dash' },
      { action: 'pickup', label: 'Pickup' },
      { action: 'crouch', label: 'Crouch / Slide' },
      { action: 'sprint', label: 'Sprint' },
    ],
  },
  {
    title: 'Combat',
    actions: [
      { action: 'weapon1', label: 'Hammer' },
      { action: 'weapon2', label: 'Sword' },
      { action: 'attack', label: 'Primary Attack' },
      { action: 'altAttack', label: 'Alt Attack' },
      { action: 'scoreboard', label: 'Scoreboard' },
    ],
  },
];

export function CompactKeybindList({ bindings, rebinding, onPick }: KbVisualizerProps) {
  return (
    <div className="compact-keybind-list bg-slate-950/55 border border-white/10 rounded-xl p-3.5 flex-col gap-3">
      {COMPACT_KEYBIND_SECTIONS.map((section) => (
        <div key={section.title} className="flex flex-col gap-2">
          <p className="text-[10px] text-cyan-400 font-black uppercase tracking-widest border-b border-white/5 pb-1.5">
            {section.title}
          </p>
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2">
            {section.actions.map(({ action, label }) => (
              <div key={action}>
                <KbBindRow
                  label={label}
                  action={action}
                  bindings={bindings}
                  rebinding={rebinding}
                  onPick={onPick}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Shared "Hold to Sprint" toggle, used in both the Controls and Gamepad panels.
// When ON (default) the player must hold the sprint button to sprint; when OFF
// a single tap toggles sprint on/off.
export function SprintModeToggle({ keybindings, setKeybindings }: {
  keybindings: Keybindings;
  setKeybindings: React.Dispatch<React.SetStateAction<Keybindings>>;
}) {
  const holdToSprint = keybindings.holdToSprint !== false;
  const toggle = () => {
    setKeybindings(prev => {
      const updated = { ...prev, holdToSprint: !(prev.holdToSprint !== false) };
      try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
      return updated;
    });
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/80">Hold to Sprint</span>
        <span className="text-[10px] text-white/40 leading-snug mt-0.5">
          {holdToSprint ? 'Hold the sprint button to sprint.' : 'Tap once to toggle sprint on / off.'}
        </span>
      </div>
      <button
        onClick={toggle}
        role="switch"
        aria-checked={holdToSprint}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors cursor-pointer ${holdToSprint ? 'bg-cyan-500' : 'bg-slate-800'}`}
        style={{ backgroundColor: holdToSprint ? '#06b6d4' : '#1e293b' }}
      >
        <span
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
          style={{ transform: holdToSprint ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  );
}
