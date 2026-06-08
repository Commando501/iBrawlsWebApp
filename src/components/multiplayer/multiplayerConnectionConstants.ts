export const SIGNED_IN_ELSEWHERE_CLOSE_CODE = 4001;
export const SIGNED_IN_ELSEWHERE_MESSAGE = 'Signed in elsewhere. This page was taken offline to prevent account cloning.';

export type GameplayConnectionMode = 'relay' | 'local';
export type GameplayConnectionStatus = 'idle' | 'fetching_ip' | 'hosting' | 'connecting' | 'connected' | 'error';
export type GameplayMultiplayerRole = 'host' | 'client' | 'observer' | null;
