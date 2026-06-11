import { Film, Map, Shield } from 'lucide-react';

const CREATIVE_TOOLS = [
  {
    href: '/mapmaker.html',
    Icon: Map,
    title: 'Map Maker',
    description: 'Build custom arenas with the voxel map editor, then host them in sandbox or multiplayer lobbies.',
    accent: 'text-[#38bdf8] border-cyan-500/25 hover:border-cyan-400/60 hover:bg-cyan-950/20',
  },
  {
    href: '/animation-editor.html',
    Icon: Film,
    title: 'Animation Editor',
    description: 'Author and preview combatant animation clips used by player and AI rigs.',
    accent: 'text-[#38bdf8] border-cyan-500/25 hover:border-cyan-400/60 hover:bg-cyan-950/20',
  },
  {
    href: '/armor-model-editor.html',
    Icon: Shield,
    title: 'Armor Editor',
    description: 'Sculpt custom V2 armor pieces and save them to your Armory catalog.',
    accent: 'text-purple-200 border-purple-500/25 hover:border-purple-400/60 hover:bg-purple-950/20',
  },
] as const;

export function CreativeToolsPanel() {
  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto pr-1 gap-4 max-w-2xl">
      <p className="text-xs text-white/50 leading-normal">
        Creation tools open in a new browser tab. Anything you build is saved locally and becomes available back here in the main menu.
      </p>
      <div className="flex flex-col gap-3">
        {CREATIVE_TOOLS.map(({ href, Icon, title, description, accent }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-start gap-4 bg-white/5 border rounded-lg p-4 transition-all cursor-pointer ${accent}`}
          >
            <Icon className="w-6 h-6 shrink-0 mt-0.5" />
            <span className="flex flex-col gap-1 min-w-0">
              <span className="text-sm font-black uppercase tracking-wider">{title}</span>
              <span className="text-xs text-white/50 leading-normal normal-case font-sans">{description}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
