const PUBLIC_ROOM_CODE_PATTERN = /^(?:\d{6}|QP_\d{6})$/i;

export const normalizePublicRoomCode = (roomCode: unknown): string | undefined => {
  if (typeof roomCode !== 'string') return undefined;
  const normalized = roomCode.trim();
  return PUBLIC_ROOM_CODE_PATTERN.test(normalized) ? normalized.toUpperCase() : undefined;
};

export const isPublicRoomCode = (roomCode: unknown): roomCode is string => {
  return normalizePublicRoomCode(roomCode) !== undefined;
};
