import type {
  BibleCitationSettings,
  PronunciationDictionarySettings,
} from "./types";
import { normalizeBibleReferences } from "./bibleReferences";
import { applyPronunciationRules } from "./pronunciationDictionary";

/** Pipeline único: estructura bíblica primero, correcciones de pronunciación al final. */
export function prepareTextForTts(
  text: string,
  bibleCitations: BibleCitationSettings,
  pronunciationDictionary: PronunciationDictionarySettings
): string {
  const bibleNormalized = normalizeBibleReferences(text, bibleCitations);
  return applyPronunciationRules(bibleNormalized, pronunciationDictionary);
}
