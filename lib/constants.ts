import type { FishModel, OutputFormat } from "./types";

export const PROMO_END_ISO = "2026-09-18T00:00:00Z";
export const PRICING_TTS_PER_M_CHARS = 15; // USD (después de la promo)
export const PRICING_STT_PER_HOUR = 0.36; // USD (después de la promo)

export interface ModelInfo {
  id: FishModel;
  name: string;
  tagline: string;
  languages: string;
  markers: "bracket" | "paren";
  dialog: boolean;
  recommended?: boolean;
}

export const MODELS: ModelInfo[] = [
  {
    id: "s2.1-pro",
    name: "S2.1 Pro",
    tagline: "La mejor calidad. Clonación por referencia, prosodia en lenguaje natural y diálogo de 2 voces.",
    languages: "80+ idiomas",
    markers: "bracket",
    dialog: true,
    recommended: true,
  },
  {
    id: "s2-pro",
    name: "S2 Pro",
    tagline: "Alta calidad con control de prosodia natural y diálogo multi-hablante.",
    languages: "80+ idiomas",
    markers: "bracket",
    dialog: true,
  },
  {
    id: "s1",
    name: "S1",
    tagline: "Modelo clásico con marcadores explícitos de emoción, tono y efectos de sonido.",
    languages: "13 idiomas",
    markers: "paren",
    dialog: false,
  },
];

/** Marcadores que se insertan en el texto para controlar la entrega (S2: corchetes, S1: paréntesis) */
export const MARKERS: Record<ModelInfo["markers"], string[]> = {
  bracket: [
    "[whispers]",
    "[excited]",
    "[sadly]",
    "[softly]",
    "[loudly]",
    "[slowly]",
    "[quickly]",
    "[calm]",
    "[pause]",
    "[with emphasis]",
  ],
  paren: [
    "(excited)",
    "(angry)",
    "(sad)",
    "(laughing)",
    "(sighing)",
    "(whispering)",
    "(crying)",
    "(fearful)",
    "(tired)",
    "(shouting)",
    "(murmuring)",
    "(sniffing)",
    "(sobbing)",
    "(vocal-fry)",
  ],
};

export const LANGUAGES: { code: string; label: string }[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "Inglés" },
  { code: "zh", label: "Chino" },
  { code: "ja", label: "Japonés" },
  { code: "ko", label: "Coreano" },
  { code: "de", label: "Alemán" },
  { code: "fr", label: "Francés" },
  { code: "pt", label: "Portugués" },
  { code: "it", label: "Italiano" },
  { code: "ru", label: "Ruso" },
  { code: "ar", label: "Árabe" },
  { code: "hi", label: "Hindi" },
  { code: "tr", label: "Turco" },
  { code: "vi", label: "Vietnamita" },
  { code: "id", label: "Indonesio" },
  { code: "nl", label: "Neerlandés" },
  { code: "pl", label: "Polaco" },
  { code: "th", label: "Tailandés" },
];

export const TAGS = [
  "male",
  "female",
  "narration",
  "calm",
  "serious",
  "energetic",
  "warm",
  "young",
  "old",
  "cute",
  "professional",
  "gaming",
  "anime",
  "news",
  "audiobook",
  "assistant",
  "villain",
  "hero",
];

export const MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
  flac: "audio/flac",
  pcm: "audio/L16",
};

export function mimeForFormat(format: OutputFormat): string {
  switch (format) {
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "opus":
      return "audio/ogg";
    case "pcm":
      return "audio/L16";
  }
}

export function extForFormat(format: OutputFormat): string {
  return format === "opus" ? "opus" : format;
}
