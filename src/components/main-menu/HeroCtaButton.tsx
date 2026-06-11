import type { ReactNode } from 'react';

type HeroCtaVariant = 'sky' | 'emerald' | 'quickplay';

interface HeroCtaButtonProps {
  label: string;
  variant: HeroCtaVariant;
  onClick: () => void;
  disabled?: boolean;
  id?: string;
  icon?: ReactNode;
  title?: string;
}

const PLAY_ICON = (
  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
  </svg>
);

const VARIANT_BUTTON: Record<HeroCtaVariant, string> = {
  sky: 'bg-white hover:bg-sky-400 border-white/20',
  emerald: 'bg-emerald-500 hover:bg-emerald-400 border-emerald-400/20',
  quickplay: 'bg-gradient-to-r from-sky-400 via-indigo-400 to-purple-500 hover:from-sky-500 hover:to-purple-600 border-sky-300/30 shadow-sky-500/25',
};

const VARIANT_LABEL: Record<HeroCtaVariant, string> = {
  sky: 'text-slate-900 group-hover:text-white',
  emerald: 'text-slate-950',
  quickplay: 'text-slate-950 group-hover:text-white',
};

export function HeroCtaButton({
  label,
  variant,
  onClick,
  disabled = false,
  id,
  icon = PLAY_ICON,
  title,
}: HeroCtaButtonProps) {
  if (disabled) {
    return (
      <button
        id={id}
        type="button"
        disabled
        title={title}
        className="w-full h-16 bg-white/5 border border-white/5 rounded flex items-center justify-center select-none cursor-not-allowed"
      >
        <span className="text-white/25 font-sans font-black text-sm uppercase tracking-widest flex items-center gap-2">
          {label}
        </span>
      </button>
    );
  }

  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      title={title}
      className={`group relative w-full h-16 transition-all duration-300 flex items-center justify-center overflow-hidden cursor-pointer rounded shadow-2xl border select-none pointer-events-auto ${VARIANT_BUTTON[variant]}`}
    >
      {variant === 'sky' && (
        <div className="absolute inset-0 bg-blue-600 translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-300" />
      )}
      <span className={`relative z-10 font-sans font-black text-sm uppercase tracking-widest pointer-events-none flex items-center gap-2 ${VARIANT_LABEL[variant]}`}>
        {label}
        {icon}
      </span>
    </button>
  );
}
