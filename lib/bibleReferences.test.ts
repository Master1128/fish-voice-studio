import { describe, expect, it } from "vitest";
import { normalizeBibleReferences, numberToSpanish } from "./bibleReferences";
import { splitLongText } from "./client";

const compact = { enabled: true, style: "compact" as const };
const narrated = { enabled: true, style: "narrated" as const };

describe("numberToSpanish", () => {
  it("convierte capítulos y versículos con acentos correctos", () => {
    expect(numberToSpanish(1)).toBe("uno");
    expect(numberToSpanish(16)).toBe("dieciséis");
    expect(numberToSpanish(22)).toBe("veintidós");
    expect(numberToSpanish(26)).toBe("veintiséis");
    expect(numberToSpanish(119)).toBe("ciento diecinueve");
    expect(numberToSpanish(176)).toBe("ciento setenta y seis");
    expect(numberToSpanish(999)).toBe("novecientos noventa y nueve");
  });
});

describe("normalizeBibleReferences", () => {
  it("normaliza referencias básicas en estilo compacto", () => {
    expect(normalizeBibleReferences("Génesis 1:1", compact)).toBe("Génesis, uno, uno");
    expect(normalizeBibleReferences("Juan 3:2", compact)).toBe("Juan, tres, dos");
    expect(normalizeBibleReferences("Hebreos 11:3", compact)).toBe("Hebreos, once, tres");
  });

  it("normaliza referencias básicas en estilo narrado", () => {
    expect(normalizeBibleReferences("Génesis 1:1", narrated)).toBe(
      "Génesis, capítulo uno, versículo uno"
    );
    expect(normalizeBibleReferences("Juan 3:16-18", narrated)).toBe(
      "Juan, capítulo tres, versículos dieciséis al dieciocho"
    );
  });

  it("reconoce abreviaturas con y sin punto y sin tilde", () => {
    expect(normalizeBibleReferences("Gn. 1:1; Jn 3:16; Heb. 11:3", compact)).toBe(
      "Génesis, uno, uno; Juan, tres, dieciséis; Hebreos, once, tres"
    );
    expect(normalizeBibleReferences("Genesis 2:3", compact)).toBe("Génesis, dos, tres");
  });

  it("reconoce libros numerados", () => {
    expect(normalizeBibleReferences("1 Juan 4:8", compact)).toBe(
      "Primera de Juan, cuatro, ocho"
    );
    expect(normalizeBibleReferences("II Corintios 5:17", narrated)).toBe(
      "Segunda a los Corintios, capítulo cinco, versículo diecisiete"
    );
    expect(normalizeBibleReferences("3 Jn. 1:2", compact)).toBe(
      "Tercera de Juan, uno, dos"
    );
  });

  it("soporta listas y rangos de versículos", () => {
    expect(normalizeBibleReferences("Hebreos 11:3, 6-8", compact)).toBe(
      "Hebreos, once, tres y seis al ocho"
    );
    expect(normalizeBibleReferences("1 Co 13:4,7-8", narrated)).toBe(
      "Primera a los Corintios, capítulo trece, versículos cuatro y siete al ocho"
    );
    expect(normalizeBibleReferences("Salmos 23:1 y 4–6", compact)).toBe(
      "Salmos, veintitrés, uno y cuatro al seis"
    );
  });

  it("soporta varias citas y grupos de capítulos", () => {
    expect(normalizeBibleReferences("Juan 3:16; 4:1-3", narrated)).toBe(
      "Juan, capítulo tres, versículo dieciséis; capítulo cuatro, versículos uno al tres"
    );
    expect(
      normalizeBibleReferences("Lea Génesis 1:1 y luego Hebreos 11:3.", compact)
    ).toBe("Lea Génesis, uno, uno y luego Hebreos, once, tres.");
  });

  it("no consume comas de prosa después de la referencia", () => {
    expect(normalizeBibleReferences("Juan 3:16, dice el texto, habla del amor.", narrated)).toBe(
      "Juan, capítulo tres, versículo dieciséis, dice el texto, habla del amor."
    );
  });

  it("no modifica horas, proporciones, URL ni números sin libro", () => {
    const source = "Llegó a las 13:45. Pantalla 16:9. https://ejemplo.com/a:2. Número 3:16.";
    expect(normalizeBibleReferences(source, compact)).toBe(source);
  });

  it("no modifica citas inválidas o desactivadas", () => {
    expect(normalizeBibleReferences("Juan 0:1 y Juan 3:0", compact)).toBe(
      "Juan 0:1 y Juan 3:0"
    );
    expect(normalizeBibleReferences("Génesis 1:1", { enabled: false, style: "compact" })).toBe(
      "Génesis 1:1"
    );
  });

  it("preserva marcadores de prosodia y diálogo", () => {
    const source = "<|speaker:0|>[softly] Juan 3:16. <|speaker:1|>(sad) Hebreos 11:3.";
    expect(normalizeBibleReferences(source, compact)).toBe(
      "<|speaker:0|>[softly] Juan, tres, dieciséis. <|speaker:1|>(sad) Hebreos, once, tres."
    );
  });

  it("es idempotente", () => {
    const once = normalizeBibleReferences("Génesis 1:1 y Juan 3:16", compact);
    expect(normalizeBibleReferences(once, compact)).toBe(once);
  });

  it("se integra con la división de texto sin perder contenido", () => {
    const source = Array.from(
      { length: 20 },
      (_, i) => `La cita número ${i + 1} es Juan 3:16 y enseña algo importante.`
    ).join(" ");
    const normalized = normalizeBibleReferences(source, narrated);
    const chunks = splitLongText(normalized, 450);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join(" ")).toBe(normalized);
    expect(chunks.every((chunk) => chunk.length <= 450)).toBe(true);
  });
});
