export type V3CandidateSlot =
  | 'helmet'
  | 'neck'
  | 'chest'
  | 'shoulder'
  | 'upperArm'
  | 'forearm'
  | 'hand'
  | 'pelvis'
  | 'thigh'
  | 'shin'
  | 'foot'
  | 'back'
  | 'weapon'
  | 'hammer'
  | 'sword'
  | 'pistol'
  | 'unknown';

export type V3CandidatePaintRole =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'undersuit'
  | 'visor'
  | 'emissive'
  | 'decal'
  | 'fixed';

export interface V3ReferencePartInput {
  objectName: string;
  groupNames?: string[];
  materialNames: string[];
}

export interface V3ReferencePartClassification {
  slot: V3CandidateSlot;
  paintRoles: V3CandidatePaintRole[];
}

interface KeywordRule<T> {
  value: T;
  patterns: RegExp[];
}

const SLOT_RULES: KeywordRule<V3CandidateSlot>[] = [
  { value: 'hammer', patterns: [/\bhammer\b/, /\bgravity\s+hammer\b/] },
  { value: 'sword', patterns: [/\bsword\b/, /\bblade\b/, /\benergy\s+sword\b/] },
  { value: 'pistol', patterns: [/\bpistol\b/, /\bsidearm\b/, /\bmagnum\b/] },
  { value: 'helmet', patterns: [/\bhelmet\b/, /\bhead\b/, /\bvisor\s+module\b/] },
  { value: 'neck', patterns: [/\bneck\b/, /\bcollar\b/] },
  { value: 'chest', patterns: [/\bchest\b/, /\btorso\b/, /\bbody\b/, /\bknife\b/] },
  { value: 'shoulder', patterns: [/\bshoulder\b/, /\bpauldron\b/] },
  { value: 'forearm', patterns: [/\bforearm\b/, /\bgauntlet\b/] },
  { value: 'upperArm', patterns: [/\bupper\s+arm\b/, /\bbicep\b/, /\barm\b/] },
  { value: 'hand', patterns: [/\bhand\b/, /\bglove\b/, /\bwrist\b/] },
  { value: 'pelvis', patterns: [/\bpelvis\b/, /\bwaist\b/, /\bhip\b/] },
  { value: 'thigh', patterns: [/\bthigh\b/, /\bupper\s+leg\b/] },
  { value: 'shin', patterns: [/\bshin\b/, /\bknee\b/, /\blower\s+leg\b/] },
  { value: 'foot', patterns: [/\bfoot\b/, /\bboot\b/, /\btoe\b/] },
  { value: 'back', patterns: [/\bback\b/, /\bbackpack\b/, /\bequipment\s+pack\b/] },
  { value: 'weapon', patterns: [/\bweapon\b/, /\bgrip\b/, /\bhandle\b/] },
];

const PAINT_ROLE_RULES: KeywordRule<V3CandidatePaintRole>[] = [
  { value: 'primary', patterns: [/\bprimary\b/, /\bmain\b/] },
  { value: 'secondary', patterns: [/\bsecondary\b/] },
  { value: 'accent', patterns: [/\baccent\b/, /\btrim\b/] },
  { value: 'undersuit', patterns: [/\bundersuit\b/, /\brubber\b/, /\bsuit\b/] },
  { value: 'visor', patterns: [/\bvisor\b/, /\bglass\b/] },
  { value: 'emissive', patterns: [/\bemissive\b/, /\bshield\s+display\b/, /\blight\b/] },
  { value: 'decal', patterns: [/\bdecal\b/, /\bdetail\b/, /\bmarking\b/] },
  { value: 'fixed', patterns: [/\bfixed\b/] },
];

const normalizeForMatching = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_:.[\](){}-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const matchesAny = (source: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(source));

const addUnique = <T>(values: T[], value: T): void => {
  if (!values.includes(value)) values.push(value);
};

const classifySlot = (input: V3ReferencePartInput): V3CandidateSlot => {
  const source = normalizeForMatching([input.objectName, ...(input.groupNames ?? [])].join(' '));
  const match = SLOT_RULES.find((rule) => matchesAny(source, rule.patterns));
  return match?.value ?? 'unknown';
};

const classifyPaintRoles = (materialNames: string[]): V3CandidatePaintRole[] => {
  const roles: V3CandidatePaintRole[] = [];

  for (const materialName of materialNames) {
    const source = normalizeForMatching(materialName);
    const match = PAINT_ROLE_RULES.find((rule) => matchesAny(source, rule.patterns));
    addUnique(roles, match?.value ?? 'fixed');
  }

  return roles.length > 0 ? roles : ['fixed'];
};

export function classifyV3ReferencePart(
  input: V3ReferencePartInput
): V3ReferencePartClassification {
  return {
    slot: classifySlot(input),
    paintRoles: classifyPaintRoles(input.materialNames),
  };
}
