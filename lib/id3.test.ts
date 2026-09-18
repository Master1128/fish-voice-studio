import { describe, expect, it } from "vitest";
import { buildId3Tag } from "./id3";

/** Lee de vuelta la etiqueta para comprobar que la estructura es válida. */
function readTag(tag: Uint8Array) {
  const magic = String.fromCharCode(tag[0], tag[1], tag[2]);
  const declaredSize =
    (tag[6] << 21) | (tag[7] << 14) | (tag[8] << 7) | tag[9];

  const frames: Record<string, string> = {};
  let offset = 10;
  while (offset + 10 <= tag.length) {
    const id = String.fromCharCode(tag[offset], tag[offset + 1], tag[offset + 2], tag[offset + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size =
      (tag[offset + 4] << 24) | (tag[offset + 5] << 16) | (tag[offset + 6] << 8) | tag[offset + 7];
    const body = tag.subarray(offset + 10, offset + 10 + size);
    // salta el byte de codificación y el BOM, y decodifica UTF-16LE
    const textBytes = body.subarray(3);
    let text = "";
    for (let i = 0; i + 1 < textBytes.length; i += 2) {
      const code = textBytes[i] | (textBytes[i + 1] << 8);
      if (code !== 0) text += String.fromCharCode(code);
    }
    frames[id] = text;
    offset += 10 + size;
  }
  return { magic, declaredSize, frames, totalSize: tag.length };
}

describe("buildId3Tag", () => {
  it("escribe una cabecera ID3v2.3 con el tamaño syncsafe correcto", () => {
    const tag = buildId3Tag({ title: "Capítulo uno", album: "Mi libro" });
    const parsed = readTag(tag);
    expect(parsed.magic).toBe("ID3");
    expect(tag[3]).toBe(3); // versión 2.3
    expect(parsed.declaredSize).toBe(parsed.totalSize - 10);
  });

  it("conserva acentos y eñes (por eso se usa UTF-16, no ISO-8859-1)", () => {
    const parsed = readTag(
      buildId3Tag({
        title: "El niño y la mañana",
        album: "Añoranza",
        artist: "José Martínez",
        track: "3/17",
        genre: "Audiobook",
      })
    );
    expect(parsed.frames.TIT2).toBe("El niño y la mañana");
    expect(parsed.frames.TALB).toBe("Añoranza");
    expect(parsed.frames.TPE1).toBe("José Martínez");
    expect(parsed.frames.TRCK).toBe("3/17");
    expect(parsed.frames.TCON).toBe("Audiobook");
  });

  it("copia el artista en TPE2 para que la app agrupe el libro", () => {
    const parsed = readTag(buildId3Tag({ title: "x", artist: "Autora" }));
    expect(parsed.frames.TPE2).toBe("Autora");
  });

  it("omite los frames vacíos en lugar de escribirlos en blanco", () => {
    const parsed = readTag(buildId3Tag({ title: "Solo título" }));
    expect(Object.keys(parsed.frames)).toEqual(["TIT2"]);
  });

  it("el descriptor vacío de COMM incluye BOM y terminador nulo", () => {
    // Sin el terminador, ffprobe y otros lectores toman el texto real como
    // descriptor y el comentario queda vacío.
    const tag = buildId3Tag({ title: "x", comment: "Nota" });
    let offset = 10;
    while (offset + 10 <= tag.length) {
      const id = String.fromCharCode(...tag.subarray(offset, offset + 4));
      const size =
        (tag[offset + 4] << 24) | (tag[offset + 5] << 16) | (tag[offset + 6] << 8) | tag[offset + 7];
      if (id === "COMM") {
        const body = tag.subarray(offset + 10, offset + 10 + size);
        expect(body[0]).toBe(0x01); // UTF-16
        expect(String.fromCharCode(body[1], body[2], body[3])).toBe("spa");
        expect([...body.subarray(4, 8)]).toEqual([0xff, 0xfe, 0x00, 0x00]);
        return;
      }
      offset += 10 + size;
    }
    throw new Error("no se escribió el frame COMM");
  });

  it("los bytes de tamaño de la cabecera nunca superan 0x7f", () => {
    const tag = buildId3Tag({
      title: "t".repeat(300),
      album: "a".repeat(300),
      comment: "c".repeat(300),
    });
    for (let i = 6; i < 10; i++) expect(tag[i]).toBeLessThanOrEqual(0x7f);
    expect(readTag(tag).declaredSize).toBe(tag.length - 10);
  });
});
