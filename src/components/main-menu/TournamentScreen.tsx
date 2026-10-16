import React, { type ComponentProps } from 'react';
import { Trophy } from 'lucide-react';
import type { MainMenuPrimaryPanel } from './MainMenuPrimaryPanel';
import { TournamentSetupPanel } from '../tournament/TournamentSetupPanel';
import { TournamentBracketPanel } from '../tournament/TournamentBracketPanel';
import { getTournamentBotCount, getTournamentRoundLabels } from '../../features/tournament/tournament';
import { NEURAL_BRAIN_DEFINITIONS } from '../../game/neuralBrains';
import { normalizeVisualModelPolicy, VISUAL_MODEL_POLICY_OPTIONS } from '../../model/modelSystem';

export interface TournamentScreenProps {
  game: ComponentProps<typeof MainMenuPrimaryPanel>;
}

export function TournamentScreen({ game }: TournamentScreenProps) {
  const state = game.tournamentState;
  const rounds = state?.roundCount ?? game.tournamentRoundCount;
  const kills = state?.killsToWin ?? game.tournamentKillsToWin;
  const modelPolicy = normalizeVisualModelPolicy(game.adminSettings.visualModelPolicy);
  const roundLabels = getTournamentRoundLabels(rounds);
  const match = state?.rounds[state.currentRound]?.find((item) => item.opponent1 === 'player' || item.opponent2 === 'player');
  const opponentId = match ? match.opponent1 === 'player' ? match.opponent2 : match.opponent1 : undefined;
  const opponent = opponentId ? state?.opponents[opponentId] : undefined;
  const statusLabel = !state ? 'SOLO · ELIMINATION' : state.status === 'victory' ? 'CHAMPION'
    : state.status === 'gameover' ? 'RUN COMPLETE' : state.status === 'playing' ? 'MATCH IN PROGRESS' : 'READY FOR YOUR NEXT MATCH';
  const title = !state ? `${rounds} ${rounds === 1 ? 'round' : 'rounds'} to victory.`
    : state.status === 'victory' ? 'You earned the title.' : state.status === 'gameover' ? 'Every run makes you stronger.'
    : `${roundLabels[state.currentRound] ?? `Round ${state.currentRound + 1}`}. Your next challenge.`;

  return (
    <section className="tournament-screen" aria-label="Tournament">
      <header className="tournament-page-heading"><div><h2>{state ? 'Your tournament' : 'Tournament setup'}</h2><p>Win your duel. Earn your place in the final.</p></div><span>{statusLabel}</span></header>
      <div className="tournament-layout">
        <div className={`tournament-controls ${state ? 'tournament-controls--bracket' : 'tournament-controls--setup'}`}>
          {state ? <TournamentBracketPanel tournamentState={state} playerName={game.playerName} playerHue={game.playerHue}
            isPlaying={game.isPlaying} onStartTournamentMatch={game.onStartTournamentMatch} onResetTournament={game.onResetTournament} />
            : <TournamentSetupPanel aiPresets={game.aiPresets} selectedTournamentPresets={game.selectedTournamentPresets}
              setSelectedTournamentPresets={game.setSelectedTournamentPresets} tournamentKillsToWin={game.tournamentKillsToWin}
              setTournamentKillsToWin={game.setTournamentKillsToWin} tournamentRoundCount={game.tournamentRoundCount}
              setTournamentRoundCount={game.setTournamentRoundCount} onInitializeTournament={game.onInitializeTournament} />}
        </div>
        <aside className="tournament-summary" aria-label="Tournament summary">
          <figure className="tournament-art"><img src="/assets/menu/tournament-iron-vanguard.png" alt="Eight actual V3 Iron Vanguard game models, four red and four blue, contest the center ball" /><figcaption>IRON VANGUARD</figcaption></figure>
          <div className="tournament-summary-body"><span className="tournament-eyebrow">{state ? 'YOUR CURRENT RUN' : 'YOUR TOURNAMENT'}</span><h3>{title}</h3>
            <dl className="tournament-summary-facts"><div><dt>Match format</dt><dd>1v1 combat</dd></div><div><dt>Bracket</dt><dd>{getTournamentBotCount(rounds) + 1} brawlers</dd></div><div><dt>Win condition</dt><dd>First to {kills} kills</dd></div><div><dt>Opponents</dt><dd>{state ? state.difficulty === 'custom' ? 'Saved AI presets' : state.difficulty === 'neural-net' ? 'NeuralNet' : state.difficulty : game.selectedTournamentPresets.length ? `${game.selectedTournamentPresets.length} saved ${game.selectedTournamentPresets.length === 1 ? 'preset' : 'presets'}` : 'Generated AI lineup'}</dd></div>{state?.neuralBrainId && <div><dt>NeuralNet brain</dt><dd>{NEURAL_BRAIN_DEFINITIONS.find((brain) => brain.id === state.neuralBrainId)?.label ?? state.neuralBrainId}</dd></div>}</dl>
            <label className="tournament-model-policy" htmlFor="tournament-model-policy"><span>Character model set</span><select id="tournament-model-policy" value={modelPolicy} onChange={event => game.setAdminSettings(previous => ({ ...previous, visualModelPolicy: normalizeVisualModelPolicy(event.target.value) }))}>{VISUAL_MODEL_POLICY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            {state && <div className="tournament-run-progress"><span>Round {Math.min(state.currentRound + 1, rounds)} of {rounds}</span><div>{roundLabels.map((label, index) => <span key={label} title={label} className={state.status === 'victory' || index < state.currentRound ? 'is-complete' : index === state.currentRound ? 'is-current' : ''} />)}</div></div>}
            {opponent && state?.status !== 'victory' && state?.status !== 'gameover' ? <div className="tournament-next-opponent"><span>YOUR OPPONENT</span><strong><i style={{ backgroundColor: `hsl(${opponent.hue}, 80%, 50%)` }} />{opponent.name}</strong><p>Your duel decides whether you advance.</p></div>
              : <p className="tournament-format-note"><Trophy size={17} aria-hidden="true" />One opponent per match. One loss ends your run.</p>}
          </div>
        </aside>
      </div>
    </section>
  );
}
