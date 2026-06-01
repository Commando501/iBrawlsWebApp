import { type LegacyRosterProps } from '../../game/rosterSlotConfig';
import { type GrifballGameProps } from './GrifballGameProps';

const OFFLINE_BOT_NAMES = [
  'DoomBot Green',
  'DoomBot Purple',
  'DoomBot Orange',
  'DoomBot Yellow',
  'DoomBot Magenta',
  'DoomBot Cyan',
];

type LegacyRosterPropValues = Pick<
  GrifballGameProps,
  | 'botDifficulties'
  | 'botBehaviors'
  | 'botWeaponBehaviors'
  | 'botArchetypes'
  | 'botColors'
>;

export const buildLegacyRosterProps = ({
  opponentPlayerName,
  botDifficulties,
  botBehaviors,
  botWeaponBehaviors,
  botArchetypes,
  botColors,
}: LegacyRosterPropValues & {
  opponentPlayerName: string;
}): LegacyRosterProps => {
  const names: Record<string, string> = {
    main_ai: opponentPlayerName || 'DoomBot',
  };
  OFFLINE_BOT_NAMES.forEach((name, i) => {
    names[`bot_${i + 2}`] = name;
  });

  return {
    botDifficulties,
    botBehaviors,
    botWeaponBehaviors,
    botArchetypes,
    botColors,
    botNames: names,
  };
};
