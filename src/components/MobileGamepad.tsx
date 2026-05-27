/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GameStats, Keybindings, DEFAULT_KEYBINDINGS } from '../types';
import { Shield, Zap, Sparkles, Sword } from 'lucide-react';

interface LeftStickProps {
  mobileJoystickRef: React.MutableRefObject<{ x: number; y: number }>;
  isAdjustmentMode: boolean;
}

export const LeftAnalogStick: React.FC<LeftStickProps> = ({
  mobileJoystickRef,
  isAdjustmentMode
}) => {
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isAdjustmentMode) return;
    setActive(true);
    handleTouchMove(e);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isAdjustmentMode || !stickRef.current || !knobRef.current) return;
    const touch = e.touches[0];
    const rect = stickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = touch.clientX - centerX;
    const deltaY = touch.clientY - centerY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const maxRadius = rect.width / 2;

    let posX = deltaX;
    let posY = deltaY;

    if (distance > maxRadius) {
      posX = (deltaX / distance) * maxRadius;
      posY = (deltaY / distance) * maxRadius;
    }

    knobRef.current.style.transform = `translate(${posX}px, ${posY}px)`;

    // Write normalized values (-1 to 1)
    // Positive Y is forward in physics (opposite of screen coords where touch Y is positive downwards)
    mobileJoystickRef.current = {
      x: posX / maxRadius,
      y: -posY / maxRadius
    };
  };

  const handleTouchEnd = () => {
    setActive(false);
    if (knobRef.current) {
      knobRef.current.style.transform = 'translate(0px, 0px)';
    }
    mobileJoystickRef.current = { x: 0, y: 0 };
  };

  return (
    <div 
      ref={stickRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`mobile-left-stick w-32 h-32 rounded-full border-2 transition-all duration-300 flex items-center justify-center relative select-none ${
        active 
          ? 'border-cyan-400/80 bg-slate-950/45 shadow-[0_0_25px_rgba(6,182,212,0.3)] scale-[1.03]' 
          : 'border-white/15 bg-slate-950/25 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]'
      }`}
      style={{ backdropFilter: 'blur(10px)', pointerEvents: isAdjustmentMode ? 'none' : 'auto' }}
    >
      {/* Subtle Directional Arrows */}
      <div className="absolute top-2.5 text-white/15 text-[8.5px] font-bold font-mono">▲</div>
      <div className="absolute bottom-2.5 text-white/15 text-[8.5px] font-bold font-mono">▼</div>
      <div className="absolute left-2.5 text-white/15 text-[8.5px] font-bold font-mono">◀</div>
      <div className="absolute right-2.5 text-white/15 text-[8.5px] font-bold font-mono">▶</div>
      
      {/* Outer floating grid ring */}
      <div className="absolute inset-2 border border-dashed border-white/5 rounded-full" />

      {/* Thumb Knob */}
      <div 
        ref={knobRef}
        className={`mobile-left-knob w-14 h-14 rounded-full flex items-center justify-center transition-shadow duration-300 cursor-pointer ${
          active 
            ? 'bg-gradient-to-b from-cyan-400 to-blue-600 shadow-[0_0_15px_rgba(6,182,212,0.8)] border border-cyan-300/40' 
            : 'bg-gradient-to-b from-slate-700 to-slate-900 border border-white/10 shadow-lg'
        }`}
      >
        <div className={`w-3.5 h-3.5 rounded-full ${active ? 'bg-white' : 'bg-slate-500'}`} />
      </div>
    </div>
  );
};

interface RightPadProps {
  mobileRightJoystickRef: React.MutableRefObject<{ x: number; y: number }>;
  mobileRightJoystickActiveRef: React.MutableRefObject<boolean>;
  isAdjustmentMode: boolean;
  activeWeapon: 'hammer' | 'sword';
  stats: GameStats;
  keybindings?: Keybindings;
}

export const RightActionButtonPad: React.FC<RightPadProps> = ({
  mobileRightJoystickRef,
  mobileRightJoystickActiveRef,
  isAdjustmentMode,
  activeWeapon,
  stats,
  keybindings = DEFAULT_KEYBINDINGS
}) => {
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [isCrouched, setIsCrouched] = useState(false);

  // Keep track of stats crouch state
  useEffect(() => {
    setIsCrouched(stats.isCrouching);
  }, [stats.isCrouching]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isAdjustmentMode) return;
    setActive(true);
    mobileRightJoystickActiveRef.current = true;
    handleTouchMove(e);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isAdjustmentMode || !stickRef.current || !knobRef.current) return;
    const touch = e.touches[0];
    const rect = stickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const deltaX = touch.clientX - centerX;
    const deltaY = touch.clientY - centerY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const maxRadius = rect.width / 2;

    let posX = deltaX;
    let posY = deltaY;

    if (distance > maxRadius) {
      posX = (deltaX / distance) * maxRadius;
      posY = (deltaY / distance) * maxRadius;
    }

    knobRef.current.style.transform = `translate(${posX}px, ${posY}px)`;

    // Write normalized look values (-1 to 1)
    mobileRightJoystickRef.current = {
      x: posX / maxRadius,
      y: posY / maxRadius
    };
  };

  const handleTouchEnd = () => {
    setActive(false);
    mobileRightJoystickActiveRef.current = false;
    if (knobRef.current) {
      knobRef.current.style.transform = 'translate(0px, 0px)';
    }
    mobileRightJoystickRef.current = { x: 0, y: 0 };
  };

  // Simulate general keyboard inputs
  const triggerKeyAction = (keyName: string) => {
    const key = keybindings[keyName as keyof Keybindings] ?? keyName;
    if (typeof key !== 'string') return;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: key.toLowerCase() }));
    setTimeout(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: key.toLowerCase() }));
    }, 50);
  };

  // Dispatch custom primary/alt attacks directly to bypass pointer lock issues
  const triggerPrimaryAttack = () => {
    window.dispatchEvent(new CustomEvent('mobile-attack-primary'));
  };

  const triggerAltAttack = () => {
    window.dispatchEvent(new CustomEvent('mobile-attack-alt'));
  };

  // Toggle Crouch Stance
  const handleCrouchToggle = () => {
    const key = keybindings.crouch;
    if (isCrouched) {
      window.dispatchEvent(new KeyboardEvent('keyup', { key }));
    } else {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    }
    setIsCrouched(!isCrouched);
  };

  const primaryGlowColor = activeWeapon === 'sword' ? 'rgba(34, 211, 238, 0.65)' : 'rgba(245, 158, 11, 0.65)';
  const primaryBtnColor = activeWeapon === 'sword' ? 'from-cyan-400 to-indigo-500' : 'from-amber-400 to-orange-500';

  return (
    <div className="mobile-right-pad relative flex items-center justify-center select-none pointer-events-none">
      
      {/* 1. RIGHT ANALOG JOYSTICK (Continuous Aim/Pan) */}
      <div 
        ref={stickRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`mobile-right-stick absolute rounded-full border-2 transition-all duration-300 flex items-center justify-center pointer-events-auto ${
          active 
            ? 'border-indigo-400/80 bg-slate-950/45 shadow-[0_0_25px_rgba(99,102,241,0.3)] scale-[1.03]' 
            : 'border-white/10 bg-slate-950/25 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]'
        }`}
        style={{ backdropFilter: 'blur(10px)', pointerEvents: isAdjustmentMode ? 'none' : 'auto' }}
      >
        <div className="absolute inset-1.5 border border-dashed border-white/5 rounded-full" />
        <div className="absolute text-[8px] font-mono font-bold text-white/10">AIM & LOOK</div>

        {/* Thumb Knob */}
        <div 
          ref={knobRef}
          className={`mobile-right-knob rounded-full flex items-center justify-center transition-shadow duration-300 cursor-pointer ${
            active 
              ? 'bg-gradient-to-b from-indigo-400 to-purple-600 shadow-[0_0_15px_rgba(99,102,241,0.8)] border border-indigo-300/40' 
              : 'bg-gradient-to-b from-slate-700 to-slate-900 border border-white/10 shadow-lg'
          }`}
        >
          <div className={`w-2.5 h-2.5 rounded-full ${active ? 'bg-white' : 'bg-slate-500'}`} />
        </div>
      </div>

      {/* 2. ERGONOMIC ARC TOUCH ACTION HOTKEYS */}

      {/* CROUCH / SLIDE BUTTON */}
      <button 
        onTouchStart={handleCrouchToggle}
        className={`mobile-crouch-button absolute rounded-full pointer-events-auto flex flex-col items-center justify-center border transition-all duration-150 active:scale-90 font-mono text-[9px] font-black ${
          isCrouched 
            ? 'bg-amber-500 border-amber-400 text-slate-950 shadow-[0_0_12px_rgba(245,158,11,0.5)]' 
            : 'bg-slate-950/50 backdrop-blur-md border-white/10 text-white/70 hover:text-white'
        }`}
        style={{ pointerEvents: isAdjustmentMode ? 'none' : 'auto' }}
      >
        <div className="text-[14px] leading-none mb-0.5">▼</div>
        <span>SLIDE</span>
      </button>

      {/* SONIC DASH THICKNESS BUTTON */}
      <button 
        onTouchStart={() => triggerKeyAction('dash')}
        disabled={!stats.playerDashReady}
        className={`mobile-dash-button absolute rounded-full pointer-events-auto flex flex-col items-center justify-center border backdrop-blur-md transition-all duration-150 active:scale-90 ${
          stats.playerDashReady 
            ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.25)]' 
            : 'bg-slate-950/40 border-white/5 text-white/20'
        }`}
        style={{ pointerEvents: isAdjustmentMode ? 'none' : 'auto' }}
      >
        <Zap className="w-5.5 h-5.5 mb-0.5" />
        <span className="text-[7.5px] font-black font-mono tracking-tighter">DASH</span>
      </button>

      {/* JUMP / BOOST BUTTON */}
      <button 
        onTouchStart={() => triggerKeyAction('jump')}
        className="mobile-boost-button absolute rounded-full pointer-events-auto flex flex-col items-center justify-center bg-indigo-600/20 backdrop-blur-md border border-indigo-400/40 text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.15)] transition-all duration-150 active:scale-90"
        style={{ pointerEvents: isAdjustmentMode ? 'none' : 'auto' }}
      >
        <Sparkles className="w-6 h-6 mb-0.5" />
        <span className="text-[8px] font-black font-mono tracking-tighter">BOOST</span>
      </button>

      {/* SWAP WEAPON SELECTION WHEEL BUTTONS */}
      <div className="mobile-weapon-switcher absolute flex gap-1.5 pointer-events-auto">
        {/* Hammer Swapper */}
        <button
          onTouchStart={() => triggerKeyAction('weapon1')}
          className={`mobile-weapon-button rounded-lg flex flex-col items-center justify-center border backdrop-blur-md transition-all duration-150 active:scale-90 ${
            activeWeapon === 'hammer'
              ? 'bg-amber-500/25 border-amber-400 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
              : 'bg-slate-950/50 border-white/10 text-white/50'
          }`}
          style={{ pointerEvents: isAdjustmentMode ? 'none' : 'auto' }}
        >
          <Shield className="w-4.5 h-4.5 mb-0.5" />
          <span className="text-[7px] font-bold font-mono">HAMMER</span>
        </button>

        {/* Sword Swapper */}
        <button
          onTouchStart={() => triggerKeyAction('weapon2')}
          className={`mobile-weapon-button rounded-lg flex flex-col items-center justify-center border backdrop-blur-md transition-all duration-150 active:scale-90 ${
            activeWeapon === 'sword'
              ? 'bg-cyan-500/25 border-cyan-400 text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.3)]'
              : 'bg-slate-950/50 border-white/10 text-white/50'
          }`}
          style={{ pointerEvents: isAdjustmentMode ? 'none' : 'auto' }}
        >
          <Sword className="w-4.5 h-4.5 mb-0.5" />
          <span className="text-[7px] font-bold font-mono">SWORD</span>
        </button>
      </div>

      {/* SCOREBOARD / STATS TOGGLE */}
      <button
        onTouchStart={() => triggerKeyAction('scoreboard')}
        className={`mobile-stats-button absolute rounded border pointer-events-auto backdrop-blur-md text-[7px] font-black tracking-widest transition-all ${
          stats.showScoreboard
            ? 'bg-emerald-500 border-emerald-400 text-slate-950'
            : 'bg-slate-950/60 border-white/10 text-white/50'
        }`}
        style={{ pointerEvents: isAdjustmentMode ? 'none' : 'auto' }}
      >
        📊 STATS
      </button>

      {/* ALT ATTACK (SECONDARY SLASH SWEEP) */}
      {activeWeapon === 'sword' && (
        <button
          onTouchStart={triggerAltAttack}
          className="mobile-alt-attack-button absolute rounded-full pointer-events-auto flex flex-col items-center justify-center bg-cyan-600/35 backdrop-blur-md border-2 border-cyan-400/50 text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.35)] transition-all duration-150 active:scale-90 font-mono"
          style={{ pointerEvents: isAdjustmentMode ? 'none' : 'auto' }}
        >
          <div className="text-[12px] font-bold tracking-tighter leading-none mb-0.5">⚔️</div>
          <span className="text-[7.5px] font-black tracking-tight">SLASH</span>
        </button>
      )}

      {/* 💥 LARGE PRIMARY ATTACK BUTTON */}
      <button 
        onTouchStart={triggerPrimaryAttack}
        className={`mobile-primary-attack-button absolute rounded-full pointer-events-auto flex flex-col items-center justify-center bg-gradient-to-b ${primaryBtnColor} text-slate-950 border-2 border-white/40 transition-all duration-150 active:scale-95`}
        style={{
          boxShadow: `0 0 25px ${primaryGlowColor}, inset 0 2px 4px rgba(255,255,255,0.4)`,
          pointerEvents: isAdjustmentMode ? 'none' : 'auto'
        }}
      >
        <div className="mobile-primary-attack-icon font-bold leading-none mb-0.5">
          {activeWeapon === 'sword' ? '⚡' : '🔨'}
        </div>
        <span className="text-[9px] font-black font-sans tracking-widest uppercase">
          {activeWeapon === 'sword' ? 'LUNGE' : 'SLAM'}
        </span>
      </button>

    </div>
  );
};
