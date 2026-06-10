export const MAX_REGISTERED_DISPLAY_NAME_LENGTH = 10;
const DISCRIMINATOR_MIN = 1000;
const DISCRIMINATOR_RANGE = 9000;

export function normalizeRegisteredDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const base = value.split("#", 1)[0]?.trim().slice(0, MAX_REGISTERED_DISPLAY_NAME_LENGTH) ?? "";
  return base.length > 0 ? base : null;
}

export function normalizeRegisteredDisplayNameKey(value: unknown): string | null {
  const normalized = normalizeRegisteredDisplayName(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function randomDisplayNameDiscriminator(): string {
  const source = new Uint32Array(1);
  crypto.getRandomValues(source);
  return String(DISCRIMINATOR_MIN + (source[0] % DISCRIMINATOR_RANGE)).padStart(4, "0");
}

export function chooseSessionDiscriminator(
  baseName: string,
  activeDisplayNames: ReadonlySet<string>,
  nextDiscriminator: () => string = randomDisplayNameDiscriminator,
): string {
  const normalizedBase = normalizeRegisteredDisplayName(baseName) ?? "Player";
  const used = new Set<string>();
  for (const displayName of activeDisplayNames) {
    const normalized = typeof displayName === "string" ? displayName.toLowerCase() : "";
    if (normalized.startsWith(`${normalizedBase.toLowerCase()}#`)) {
      used.add(normalized.slice(normalized.lastIndexOf("#") + 1));
    }
  }

  for (let attempts = 0; attempts < 100; attempts++) {
    const suffix = nextDiscriminator().replace(/\D/g, "").slice(0, 4).padStart(4, "0");
    if (!used.has(suffix) && !activeDisplayNames.has(`${normalizedBase}#${suffix}`)) {
      return suffix;
    }
  }

  for (let n = DISCRIMINATOR_MIN; n < DISCRIMINATOR_MIN + DISCRIMINATOR_RANGE; n++) {
    const suffix = String(n);
    if (!used.has(suffix) && !activeDisplayNames.has(`${normalizedBase}#${suffix}`)) {
      return suffix;
    }
  }

  return String(DISCRIMINATOR_MIN);
}

export interface ResolvePublicDisplayNameOptions {
  requestedName: unknown;
  accountId?: string;
  registeredOwnerAccountId?: string | null;
  activeDisplayNames: ReadonlySet<string>;
  nextDiscriminator?: () => string;
}

export function resolvePublicDisplayName({
  requestedName,
  accountId,
  registeredOwnerAccountId,
  activeDisplayNames,
  nextDiscriminator,
}: ResolvePublicDisplayNameOptions): string {
  const baseName = normalizeRegisteredDisplayName(requestedName) ?? "Player";
  if (!registeredOwnerAccountId || registeredOwnerAccountId === accountId) {
    return baseName;
  }
  const suffix = chooseSessionDiscriminator(baseName, activeDisplayNames, nextDiscriminator);
  return `${baseName}#${suffix}`;
}

export function extractSavePlayerName(savePayload: unknown): string | null {
  if (!savePayload || typeof savePayload !== "object" || Array.isArray(savePayload)) return null;
  return normalizeRegisteredDisplayName((savePayload as Record<string, unknown>).playerName);
}

export function getPreferredRegisteredDisplayNameFromSave(
  savePayload: unknown,
  username: unknown,
): string | null {
  return extractSavePlayerName(savePayload) ?? normalizeRegisteredDisplayName(username);
}
