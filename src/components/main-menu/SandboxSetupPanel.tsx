import { VISUAL_MODEL_POLICY_OPTIONS, type VisualModelPolicy } from '../../model/modelSystem';
import { HeroCtaButton } from './HeroCtaButton';

interface SandboxSetupPanelProps {
  visualModelPolicy: VisualModelPolicy;
  onVisualModelPolicyChange: (policy: VisualModelPolicy) => void;
  onOpenBotSetup: () => void;
}

export function SandboxSetupPanel({
  visualModelPolicy,
  onVisualModelPolicyChange,
  onOpenBotSetup,
}: SandboxSetupPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 justify-between">
      <div className="flex flex-col gap-5 min-h-0 overflow-y-auto pr-0.5">
        <div className="flex items-center gap-2.5 mb-1 shrink-0">
          <span className="w-2 h-4 bg-blue-500" />
          <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
            Training Sandbox Setup
          </h2>
        </div>
        <p className="text-white/60 text-xs leading-relaxed bg-white/5 border border-white/5 rounded-lg p-3.5 leading-normal select-text shrink-0">
          This is a Grifball iBrawls simulator. The game can be played solo against AI or online against other players. All Gameplay/Mechanics Options only impact you, so coordinate with your opponent on the dials you want to match.
        </p>
        <div className="rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/45">Model Set</span>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-300">
              {visualModelPolicy.toUpperCase()}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {VISUAL_MODEL_POLICY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onVisualModelPolicyChange(option.value)}
                className={`min-h-10 rounded border px-2 text-[10px] font-black uppercase tracking-wider transition-all ${
                  visualModelPolicy === option.value
                    ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100'
                    : 'border-white/10 bg-black/35 text-white/45 hover:text-white/75'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3.5 mt-auto shrink-0 pt-4">
        <HeroCtaButton
          id="play-game-btn"
          label="Start Local Training"
          variant="sky"
          onClick={onOpenBotSetup}
        />
      </div>
    </div>
  );
}
