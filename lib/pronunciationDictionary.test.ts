import { describe, expect, it } from "vitest";
import {
  applyPronunciationRules,
  createDefaultPronunciationDictionary,
  mergePronunciationDictionaries,
  parsePronunciationDictionaryJson,
  validatePronunciationDictionary,
} from "./pronunciationDictionary";
import { prepareTextForTts } from "./ttsText";
import { splitLongText } from "./client";
import type { PronunciationDictionarySettings } from "./types";

function dictionary(
  rules: Array<[string, string, boolean?]>,
  enabled = true
): PronunciationDictionarySettings {
  return {
    version: 1,
    enabled,
    rules: rules.map(([source, replacement, ruleEnabled = true], index) => ({
      id: `r${index}`,
      source,
      replacement,
      enabled: ruleEnabled,
    })),
  };
}

describe("applyPronunciationRules", () => {
  it("incluye la corrección inicial de mengüe", () => {
    const settings = createDefaultPronunciationDictionary();
    expect(applyPronunciationRules("para que mengüe el poder", settings)).toBe(
      "para que méngüe el poder"
    );
  });

  it("coincide sin distinguir mayúsculas", () => {
    const settings = dictionary([["mengüe", "méngüe"]]);
    expect(applyPronunciationRules("mengüe Mengüe MENGÜE", settings)).toBe(
      "méngüe méngüe méngüe"
    );
  });

  it("solo coincide con palabras completas", () => {
    const settings = dictionary([["mengüe", "méngüe"]]);
    expect(applyPronunciationRules("mengüe mengües premengüe", settings)).toBe(
      "méngüe mengües premengüe"
    );
  });

  it("respeta tildes y diéresis", () => {
    const settings = dictionary([["mengüe", "méngüe"]]);
    expect(applyPronunciationRules("mengue mengüe", settings)).toBe("mengue méngüe");
  });

  it("normaliza Unicode NFC/NFD", () => {
    const decomposed = "mengu\u0308e";
    const settings = dictionary([["mengüe", "méngüe"]]);
    expect(applyPronunciationRules(decomposed, settings)).toBe("méngüe");
  });

  it("trata caracteres regex y reemplazos con dólares literalmente", () => {
    const settings = dictionary([["C++", "$1 sonido"]]);
    expect(applyPronunciationRules("Curso de C++.", settings)).toBe("Curso de $1 sonido.");
  });

  it("prioriza frases más largas", () => {
    const settings = dictionary([
      ["San", "Sán"],
      ["San Juan", "Sán Juán"],
    ]);
    expect(applyPronunciationRules("San Juan y San Pedro", settings)).toBe(
      "Sán Juán y Sán Pedro"
    );
  });

  it("no encadena reemplazos", () => {
    const settings = dictionary([
      ["alfa", "beta"],
      ["beta", "gamma"],
    ]);
    expect(applyPronunciationRules("alfa beta", settings)).toBe("beta gamma");
  });

  it("respeta activación global e individual", () => {
    expect(applyPronunciationRules("mengüe", dictionary([["mengüe", "méngüe"]], false))).toBe(
      "mengüe"
    );
    expect(applyPronunciationRules("mengüe", dictionary([["mengüe", "méngüe", false]]))).toBe(
      "mengüe"
    );
  });

  it("protege marcadores del sintetizador", () => {
    const settings = dictionary([
      ["softly", "mal"],
      ["speaker", "hablante"],
      ["sad", "triste"],
      ["mengüe", "méngüe"],
    ]);
    expect(
      applyPronunciationRules("<|speaker:0|>[softly] (sad) que mengüe", settings)
    ).toBe("<|speaker:0|>[softly] (sad) que méngüe");
  });
});

describe("validación e importación", () => {
  it("elimina fuentes duplicadas ignorando mayúsculas", () => {
    const result = validatePronunciationDictionary({
      version: 1,
      enabled: true,
      rules: [
        { id: "a", source: "Mengüe", replacement: "uno", enabled: true },
        { id: "b", source: "MENGÜE", replacement: "dos", enabled: true },
      ],
    });
    expect(result.settings.rules).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes("duplicada"))).toBe(true);
  });

  it("rechaza JSON corrupto y versión desconocida", () => {
    expect(() => parsePronunciationDictionaryJson("no-json")).toThrow("JSON válido");
    expect(() =>
      parsePronunciationDictionaryJson(JSON.stringify({ version: 99, rules: [] }))
    ).toThrow("versión");
  });

  it("combina reemplazando por fuente sin duplicarla", () => {
    const current = dictionary([["mengüe", "viejo"]]);
    const incoming = dictionary([
      ["MENGÜE", "méngüe"],
      ["YHWH", "Yavé"],
    ]);
    const merged = mergePronunciationDictionaries(current, incoming);
    expect(merged.rules).toHaveLength(2);
    expect(merged.rules[0].replacement).toBe("méngüe");
  });
});

describe("pipeline TTS", () => {
  it("aplica citas bíblicas antes del diccionario", () => {
    const result = prepareTextForTts(
      "Juan 3:16 y mengüe",
      { enabled: true, style: "compact" },
      dictionary([
        ["Juan", "Juán"],
        ["mengüe", "méngüe"],
      ])
    );
    expect(result).toBe("Juán, tres, dieciséis y méngüe");
  });

  it("divide el texto transformado sin pérdidas", () => {
    const source = "Que mengüe. ".repeat(80).trim();
    const transformed = prepareTextForTts(
      source,
      { enabled: false, style: "compact" },
      dictionary([["mengüe", "méngüe"]])
    );
    const chunks = splitLongText(transformed, 450);
    expect(chunks.join(" ")).toBe(transformed);
    expect(chunks.every((chunk) => chunk.length <= 450)).toBe(true);
  });
});
