import type {
  PronunciationDictionarySettings,
  PronunciationRule,
} from "./types";

export const PRONUNCIATION_DICTIONARY_VERSION = 1 as const;
export const MAX_PRONUNCIATION_RULES = 500;
export const MAX_SOURCE_LENGTH = 100;
export const MAX_REPLACEMENT_LENGTH = 200;
export const MAX_IMPORT_BYTES = 1024 * 1024;

export const DEFAULT_PRONUNCIATION_RULES: readonly PronunciationRule[] = [
  {
    id: "default-mengue",
    source: "mengüe",
    replacement: "méngüe",
    enabled: true,
  },
] as const;

export function createDefaultPronunciationDictionary(): PronunciationDictionarySettings {
  return {
    version: PRONUNCIATION_DICTIONARY_VERSION,
    enabled: true,
    rules: DEFAULT_PRONUNCIATION_RULES.map((rule) => ({ ...rule })),
  };
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function pronunciationSourceKey(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase("es");
}

function sanitizeSource(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SOURCE_LENGTH);
}

function sanitizeReplacement(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_REPLACEMENT_LENGTH);
}

export interface DictionaryValidationResult {
  settings: PronunciationDictionarySettings;
  warnings: string[];
}

/** Valida datos de localStorage/importación; nunca confía en ids ni tipos externos. */
export function validatePronunciationDictionary(
  input: unknown,
  options: { fallbackToDefault?: boolean } = {}
): DictionaryValidationResult {
  const warnings: string[] = [];
  if (!input || typeof input !== "object") {
    return {
      settings: options.fallbackToDefault === false
        ? { version: 1, enabled: true, rules: [] }
        : createDefaultPronunciationDictionary(),
      warnings: ["El diccionario no tiene un formato válido."],
    };
  }

  const raw = input as Record<string, unknown>;
  if (raw.version !== PRONUNCIATION_DICTIONARY_VERSION) {
    return {
      settings: options.fallbackToDefault === false
        ? { version: 1, enabled: true, rules: [] }
        : createDefaultPronunciationDictionary(),
      warnings: ["La versión del diccionario no es compatible."],
    };
  }

  const rulesInput = Array.isArray(raw.rules) ? raw.rules.slice(0, MAX_PRONUNCIATION_RULES) : [];
  if (!Array.isArray(raw.rules)) warnings.push("La lista de reglas era inválida y se ignoró.");
  if (Array.isArray(raw.rules) && raw.rules.length > MAX_PRONUNCIATION_RULES) {
    warnings.push(`Solo se importaron las primeras ${MAX_PRONUNCIATION_RULES} reglas.`);
  }

  const seen = new Set<string>();
  const usedIds = new Set<string>();
  const rules: PronunciationRule[] = [];

  for (const entry of rulesInput) {
    if (!entry || typeof entry !== "object") {
      warnings.push("Se ignoró una regla con formato inválido.");
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const source = sanitizeSource(candidate.source);
    const replacement = sanitizeReplacement(candidate.replacement);
    if (!source || !replacement) {
      warnings.push("Se ignoró una regla vacía.");
      continue;
    }
    const key = pronunciationSourceKey(source);
    if (seen.has(key)) {
      warnings.push(`Se ignoró la regla duplicada «${source}».`);
      continue;
    }
    seen.add(key);

    let id = typeof candidate.id === "string" && candidate.id.trim()
      ? candidate.id.trim().slice(0, 120)
      : makeId();
    if (usedIds.has(id)) id = makeId();
    usedIds.add(id);
    rules.push({
      id,
      source,
      replacement,
      enabled: candidate.enabled !== false,
    });
  }

  return {
    settings: {
      version: 1,
      enabled: raw.enabled !== false,
      rules,
    },
    warnings,
  };
}

export function mergePronunciationDictionaries(
  current: PronunciationDictionarySettings,
  incoming: PronunciationDictionarySettings
): PronunciationDictionarySettings {
  const merged = current.rules.map((rule) => ({ ...rule }));
  const indexBySource = new Map(
    merged.map((rule, index) => [pronunciationSourceKey(rule.source), index])
  );
  for (const rule of incoming.rules) {
    const key = pronunciationSourceKey(rule.source);
    const existing = indexBySource.get(key);
    if (existing == null) {
      if (merged.length >= MAX_PRONUNCIATION_RULES) break;
      indexBySource.set(key, merged.length);
      merged.push({ ...rule, id: usedRuleId(merged, rule.id) });
    } else {
      merged[existing] = { ...rule, id: merged[existing].id };
    }
  }
  return { version: 1, enabled: current.enabled, rules: merged };
}

function usedRuleId(rules: PronunciationRule[], preferred: string): string {
  const ids = new Set(rules.map((rule) => rule.id));
  return preferred && !ids.has(preferred) ? preferred : makeId();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PROTECTED_TTS_SYNTAX = /(<\|speaker:\d+\|>|\[[^\]\n]{1,80}\]|\((?:excited|angry|sad|laughing|sighing|whispering|crying|fearful|tired|shouting|murmuring|sniffing|sobbing|vocal-fry)\))/giu;

function applyRulesToPlainText(text: string, rules: PronunciationRule[]): string {
  if (!text || !rules.length) return text;
  const bySource = new Map<string, PronunciationRule>();
  const alternatives = rules
    .map((rule) => ({ ...rule, source: rule.source.normalize("NFC") }))
    .sort((a, b) => b.source.length - a.source.length)
    .filter((rule) => {
      const key = pronunciationSourceKey(rule.source);
      if (bySource.has(key)) return false;
      bySource.set(key, rule);
      return true;
    })
    .map((rule) => escapeRegex(rule.source).replace(/\\ /g, "\\s+"));
  if (!alternatives.length) return text;

  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}\\p{M}_])(${alternatives.join("|")})(?![\\p{L}\\p{N}\\p{M}_])`,
    "giu"
  );
  return text.normalize("NFC").replace(pattern, (full, prefix: string, matched: string) => {
    const rule = bySource.get(pronunciationSourceKey(matched));
    return rule ? `${prefix}${rule.replacement}` : full;
  });
}

/** Aplica el diccionario una sola vez y preserva los marcadores de control del TTS. */
export function applyPronunciationRules(
  text: string,
  settings: PronunciationDictionarySettings
): string {
  if (!settings.enabled || !text.trim()) return text;
  const active = settings.rules.filter(
    (rule) => rule.enabled && rule.source.trim() && rule.replacement.trim()
  );
  if (!active.length) return text;

  const pieces = text.split(PROTECTED_TTS_SYNTAX);
  return pieces
    .map((piece, index) => (index % 2 === 1 ? piece : applyRulesToPlainText(piece, active)))
    .join("");
}

export interface PronunciationDictionaryExport extends PronunciationDictionarySettings {
  exportedAt?: string;
}

export function parsePronunciationDictionaryJson(
  json: string
): DictionaryValidationResult {
  if (new Blob([json]).size > MAX_IMPORT_BYTES) {
    throw new Error("El archivo supera el máximo de 1 MB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("El archivo no contiene JSON válido.");
  }
  const result = validatePronunciationDictionary(parsed, { fallbackToDefault: false });
  if (!result.settings.rules.length && result.warnings.length) {
    throw new Error(result.warnings[0]);
  }
  return result;
}
