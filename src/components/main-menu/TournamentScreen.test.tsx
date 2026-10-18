import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TournamentScreen, type TournamentScreenProps } from './TournamentScreen';
import { TournamentSetupPanel } from '../tournament/TournamentSetupPanel';
import { TournamentBracketPanel } from '../tournament/TournamentBracketPanel';
import type { TournamentState } from '../../types';

const noop = () => {};
function game(patch: Partial<TournamentScreenProps['game']> = {}): TournamentScreenProps['game'] {
  return { tournamentState: null, aiPresets: [], selectedTournamentPresets: [], setSelectedTournamentPresets: noop,
    tournamentKillsToWin: 25, setTournamentKillsToWin: noop, tournamentRoundCount: 3, setTournamentRoundCount: noop,
    onInitializeTournament: noop, playerName: 'Pilot', playerHue: 200, isPlaying: false,
    onStartTournamentMatch: noop, onResetTournament: noop,
    adminSettings: { visualModelPolicy: 'v3' }, setAdminSettings: noop, ...patch } as TournamentScreenProps['game'];
}
function bracket(patch: Partial<TournamentState> = {}): TournamentState {
  return { difficulty: 'normal', killsToWin: 25, roundCount: 1, currentRound: 0, currentMatchIndex: 0,
    opponents: { bot_1: { id:'bot_1', name:'Talon', hue:0, difficulty:'normal', reactionLatency:.2,
      anticipationFactor:.4, movementComplexity:50, weaponSwapIQ:50, playstyle:50, behavior:'defensive' } },
    rounds: [[{ opponent1:'player', opponent2:'bot_1', isCompleted:false }]], status:'bracket', ...patch };
}
function findElement(node: React.ReactNode, type: React.ElementType): React.ReactElement<any> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement<{children?: React.ReactNode}>(child)) continue;
    if (child.type === type) return child;
    const nested = findElement(child.props.children, type);
    if (nested) return nested;
  }
}

test('Tournament screen uses the existing setup component with unchanged callback and preset identities', () => {
  const values = game();
  const tree = TournamentScreen({ game: values });
  const setup = findElement(tree, TournamentSetupPanel)!;
  assert.ok(setup);
  for (const field of ['aiPresets','selectedTournamentPresets','setSelectedTournamentPresets','tournamentKillsToWin','setTournamentKillsToWin','tournamentRoundCount','setTournamentRoundCount','onInitializeTournament']) {
    assert.equal(setup.props[field], values[field as keyof typeof values], field);
  }
  assert.equal(findElement(tree, TournamentBracketPanel), undefined);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /\/assets\/menu\/tournament-iron-vanguard.png/);
  for (const difficulty of ['Easy', 'Normal', 'Hard', 'Nightmare', 'NeuralNet']) assert.ok(html.includes(difficulty));
  assert.match(html, /3 rounds to victory/);
  assert.match(html, /8 brawlers/);
  assert.doesNotMatch(html, /Start Local Training/);
});

test('Active bracket keeps actual player identity and all start/resume/reset callbacks', () => {
  const values = game({ tournamentState: bracket({ status:'playing' }) });
  const tree = TournamentScreen({ game: values });
  const panel = findElement(tree, TournamentBracketPanel)!;
  assert.ok(panel);
  for (const field of ['tournamentState','playerName','playerHue','isPlaying','onStartTournamentMatch','onResetTournament']) assert.equal(panel.props[field], values[field as keyof typeof values]);
  assert.equal(findElement(tree, TournamentSetupPanel), undefined);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Resume Match/);
  assert.match(html, /Reset Tournament/);
  assert.match(html, /Talon/);
  assert.match(html, /Pilot \(You\)/);
});

test('Summary reads the active run configuration instead of a changed next-run draft', () => {
  const html = renderToStaticMarkup(<TournamentScreen game={game({ tournamentRoundCount:4, tournamentKillsToWin:50,
    tournamentState: bracket({difficulty:'neural-net',neuralBrainId:'combat_dr_v4'}) })} />);
  assert.match(html, /2 brawlers/);
  assert.match(html, /First to 25 kills/);
  assert.match(html, /CombatDRV4/);
  assert.doesNotMatch(html, /16 brawlers/);
});

test('Unknown saved neural brain IDs remain readable without breaking the tournament screen', () => {
  const html = renderToStaticMarkup(<TournamentScreen game={game({tournamentState:bracket({difficulty:'neural-net',neuralBrainId:'future_brain'})})} />);
  assert.match(html, /future_brain/);
  assert.match(html, /Start Next Match/);
});

test('Existing victory and elimination actions remain available', () => {
  const victory = renderToStaticMarkup(<TournamentScreen game={game({tournamentState:bracket({status:'victory'})})} />);
  const defeat = renderToStaticMarkup(<TournamentScreen game={game({tournamentState:bracket({status:'gameover'})})} />);
  assert.match(victory, /Begin New Run/);
  assert.match(victory, /You earned the title/);
  assert.match(defeat, /Restart Tournament/);
  assert.match(defeat, /Every run makes you stronger/);
  assert.doesNotMatch(victory, /Start Next Match/);
  assert.doesNotMatch(defeat, /Start Next Match/);
});

test('Character model selector preserves all model options and changes only the shared visual policy', () => {
  let update: ((previous: any) => any) | undefined;
  const values = game({ setAdminSettings: next => { update = next; } });
  const tree = TournamentScreen({ game: values });
  const select = findElement(tree, 'select')!;
  assert.equal(select.props.value, 'v3');
  assert.deepEqual(React.Children.toArray(select.props.children).map((option: any) => option.props.value), ['v1', 'v2', 'v3']);
  const previous = { visualModelPolicy: 'v3', gameMode: 'sandbox', botReactionTime: 250 };
  select.props.onChange({ target: { value: 'v1' } });
  assert.deepEqual(update!(previous), { ...previous, visualModelPolicy: 'v1' });
  select.props.onChange({ target: { value: 'invalid' } });
  assert.deepEqual(update!(previous), { ...previous, visualModelPolicy: 'v2' });
});
