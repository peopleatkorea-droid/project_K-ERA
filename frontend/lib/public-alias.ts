import type { Locale } from "./i18n";

const ADJECTIVE_LABELS = {
  warm: { ko: "따스한", en: "Warm" },
  calm: { ko: "차분한", en: "Calm" },
  clear: { ko: "맑은", en: "Clear" },
  steady: { ko: "든든한", en: "Steady" },
  delicate: { ko: "섬세한", en: "Delicate" },
  diligent: { ko: "성실한", en: "Diligent" },
  upright: { ko: "반듯한", en: "Upright" },
  wise: { ko: "지혜로운", en: "Wise" },
  quiet: { ko: "조용한", en: "Quiet" },
  agile: { ko: "민첩한", en: "Agile" },
  gentle: { ko: "푸근한", en: "Gentle" },
  radiant: { ko: "빛나는", en: "Radiant" },
  composed: { ko: "침착한", en: "Composed" },
  alert: { ko: "기민한", en: "Alert" },
  serene: { ko: "온화한", en: "Serene" },
  sturdy: { ko: "단단한", en: "Sturdy" },
  flexible: { ko: "유연한", en: "Flexible" },
  vivid: { ko: "선명한", en: "Vivid" },
  kind: { ko: "상냥한", en: "Kind" },
  bold: { ko: "담대한", en: "Bold" },
  tranquil: { ko: "고요한", en: "Tranquil" },
  healthy: { ko: "건강한", en: "Healthy" },
  honest: { ko: "정직한", en: "Honest" },
  bright: { ko: "명민한", en: "Bright" },
} as const;

const ANIMAL_LABELS = {
  gorilla: { ko: "고릴라", en: "Gorilla" },
  otter: { ko: "수달", en: "Otter" },
  tiger: { ko: "호랑이", en: "Tiger" },
  owl: { ko: "올빼미", en: "Owl" },
  fox: { ko: "여우", en: "Fox" },
  whale: { ko: "고래", en: "Whale" },
  squirrel: { ko: "다람쥐", en: "Squirrel" },
  penguin: { ko: "펭귄", en: "Penguin" },
  dolphin: { ko: "돌고래", en: "Dolphin" },
  deer: { ko: "사슴", en: "Deer" },
  cheetah: { ko: "치타", en: "Cheetah" },
  elephant: { ko: "코끼리", en: "Elephant" },
  magpie: { ko: "까치", en: "Magpie" },
  crane: { ko: "두루미", en: "Crane" },
  panda: { ko: "판다", en: "Panda" },
  wolf: { ko: "늑대", en: "Wolf" },
  beaver: { ko: "비버", en: "Beaver" },
  badger: { ko: "오소리", en: "Badger" },
  seaotter: { ko: "해달", en: "Sea Otter" },
  hawk: { ko: "매", en: "Hawk" },
  lynx: { ko: "살쾡이", en: "Lynx" },
  seal: { ko: "바다표범", en: "Seal" },
  ibex: { ko: "산양", en: "Ibex" },
  goose: { ko: "기러기", en: "Goose" },
} as const;

const CANONICAL_ALIAS_PATTERN = /^(?<adjective>[a-z]+)_(?<animal>[a-z]+)_(?<number>\d{3})$/;
const LEGACY_ALIAS_PATTERN = /^(?<adjective>\S+)\s+(?<animal>\S+)\s+#(?<number>\d{3})$/;
const CANONICAL_ANONYMOUS_PATTERN = /^anonymous_member_(?<code>[a-z0-9]{6})$/;
const LEGACY_ANONYMOUS_PATTERN = /^익명 참여자 #(?<code>[A-Za-z0-9]{6})$/;

const adjectiveKeys = Object.keys(ADJECTIVE_LABELS) as Array<keyof typeof ADJECTIVE_LABELS>;
const animalKeys = Object.keys(ANIMAL_LABELS) as Array<keyof typeof ANIMAL_LABELS>;
const adjectiveByKo = Object.fromEntries(adjectiveKeys.map((key) => [ADJECTIVE_LABELS[key].ko, key])) as Record<string, keyof typeof ADJECTIVE_LABELS>;
const adjectiveByEn = Object.fromEntries(adjectiveKeys.map((key) => [ADJECTIVE_LABELS[key].en.toLowerCase(), key])) as Record<string, keyof typeof ADJECTIVE_LABELS>;
const animalByKo = Object.fromEntries(animalKeys.map((key) => [ANIMAL_LABELS[key].ko, key])) as Record<string, keyof typeof ANIMAL_LABELS>;
const animalByEn = Object.fromEntries(animalKeys.map((key) => [ANIMAL_LABELS[key].en.toLowerCase(), key])) as Record<string, keyof typeof ANIMAL_LABELS>;

type ParsedAlias =
  | {
      kind: "canonical";
      adjective: keyof typeof ADJECTIVE_LABELS;
      animal: keyof typeof ANIMAL_LABELS;
      number: string;
    }
  | {
      kind: "anonymous";
      code: string;
    };

function parsePublicAlias(value: string | null | undefined): ParsedAlias | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  const canonicalMatch = normalized.match(CANONICAL_ALIAS_PATTERN);
  if (canonicalMatch?.groups) {
    const adjective = canonicalMatch.groups.adjective as keyof typeof ADJECTIVE_LABELS;
    const animal = canonicalMatch.groups.animal as keyof typeof ANIMAL_LABELS;
    if (adjective in ADJECTIVE_LABELS && animal in ANIMAL_LABELS) {
      return {
        kind: "canonical",
        adjective,
        animal,
        number: canonicalMatch.groups.number,
      };
    }
  }

  const anonymousMatch = normalized.match(CANONICAL_ANONYMOUS_PATTERN);
  if (anonymousMatch?.groups) {
    return {
      kind: "anonymous",
      code: anonymousMatch.groups.code.toUpperCase(),
    };
  }

  const legacyMatch = normalized.match(LEGACY_ALIAS_PATTERN);
  if (legacyMatch?.groups) {
    const adjective = adjectiveByKo[legacyMatch.groups.adjective] ?? adjectiveByEn[legacyMatch.groups.adjective.toLowerCase()];
    const animal = animalByKo[legacyMatch.groups.animal] ?? animalByEn[legacyMatch.groups.animal.toLowerCase()];
    if (adjective && animal) {
      return {
        kind: "canonical",
        adjective,
        animal,
        number: legacyMatch.groups.number,
      };
    }
  }

  const legacyAnonymousMatch = normalized.match(LEGACY_ANONYMOUS_PATTERN);
  if (legacyAnonymousMatch?.groups) {
    return {
      kind: "anonymous",
      code: legacyAnonymousMatch.groups.code.toUpperCase(),
    };
  }

  return null;
}

export function formatPublicAlias(value: string | null | undefined, locale: Locale): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }

  const parsed = parsePublicAlias(normalized);
  if (!parsed) {
    return normalized;
  }

  if (parsed.kind === "anonymous") {
    return locale === "ko" ? `익명 참여자 #${parsed.code}` : `Anonymous Member #${parsed.code}`;
  }

  const adjective = ADJECTIVE_LABELS[parsed.adjective][locale];
  const animal = ANIMAL_LABELS[parsed.animal][locale];
  return `${adjective} ${animal} #${parsed.number}`;
}
