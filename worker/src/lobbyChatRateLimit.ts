export const LOBBY_CHAT_MAX_TEXT_LENGTH = 240;
export const LOBBY_CHAT_MAX_SENDER_LENGTH = 24;
export const LOBBY_CHAT_RATE_LIMIT_WINDOW_MS = 10_000;
export const LOBBY_CHAT_RATE_LIMIT_MAX_MESSAGES = 5;
export const LOBBY_CHAT_RATE_LIMIT_COOLDOWN_MS = 15_000;

export interface LobbyChatRateLimitState {
  messageTimestamps: number[];
  mutedUntil: number;
}

export type LobbyChatValidationResult =
  | { ok: true; text: string; sender: string }
  | { ok: false; message: string; retryAfterMs?: number };

export function createLobbyChatRateLimitState(): LobbyChatRateLimitState {
  return {
    messageTimestamps: [],
    mutedUntil: 0,
  };
}

export function normalizeLobbyChatText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0 || normalized.length > LOBBY_CHAT_MAX_TEXT_LENGTH) {
    return null;
  }
  return normalized;
}

export function normalizeLobbyChatSender(sender: unknown, fallback: string): string {
  const normalized = typeof sender === "string"
    ? sender.replace(/\s+/g, " ").trim().slice(0, LOBBY_CHAT_MAX_SENDER_LENGTH)
    : "";
  return normalized.length > 0 ? normalized : fallback;
}

export function validateLobbyChatMessage(
  message: unknown,
  state: LobbyChatRateLimitState,
  fallbackSender: string,
  now = Date.now(),
): LobbyChatValidationResult {
  const raw = message && typeof message === "object"
    ? message as { sender?: unknown; text?: unknown }
    : {};
  if (state.mutedUntil > now) {
    return {
      ok: false,
      message: "Global chat is rate limited. Please wait before sending another message.",
      retryAfterMs: state.mutedUntil - now,
    };
  }

  const windowStart = now - LOBBY_CHAT_RATE_LIMIT_WINDOW_MS;
  state.messageTimestamps = state.messageTimestamps.filter((timestamp) => timestamp > windowStart);

  if (state.messageTimestamps.length >= LOBBY_CHAT_RATE_LIMIT_MAX_MESSAGES) {
    state.mutedUntil = now + LOBBY_CHAT_RATE_LIMIT_COOLDOWN_MS;
    return {
      ok: false,
      message: "Global chat is rate limited. Please wait before sending another message.",
      retryAfterMs: LOBBY_CHAT_RATE_LIMIT_COOLDOWN_MS,
    };
  }

  state.messageTimestamps.push(now);
  const text = normalizeLobbyChatText(raw.text);
  if (!text) {
    return { ok: false, message: `Global chat messages must be 1-${LOBBY_CHAT_MAX_TEXT_LENGTH} characters.` };
  }

  return {
    ok: true,
    text,
    sender: normalizeLobbyChatSender(raw.sender, fallbackSender),
  };
}
