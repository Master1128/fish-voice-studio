/**
 * Escritor mínimo de ID3v2.3 para los MP3 de capítulo.
 *
 * Sin esto, un reproductor de audiolibros muestra los archivos por nombre y
 * sin metadatos; con TALB/TRCK agrupa el libro y respeta el orden aunque el
 * usuario mueva los archivos de carpeta.
 *
 * Se usa UTF-16 con BOM (codificación 0x01) porque es la única que ID3v2.3
 * define para texto no latino-1: con acentos y «ñ», ISO-8859-1 falla.
 */

export interface Id3Tags {
  /** TIT2 — título de la pista (el capítulo) */
  title: string;
  /** TALB — álbum (el libro) */
  album?: string;
  /** TPE1 — artista (el autor o la voz) */
  artist?: string;
  /** TPE2 — artista del álbum, lo que agrupa el libro en la mayoría de apps */
  albumArtist?: string;
  /** TRCK — «3/17» */
  track?: string;
  /** TCON — género */
  genre?: string;
  /** COMM — comentario libre */
  comment?: string;
}

function utf16WithBom(text: string): Uint8Array {
  const units: number[] = [];
  for (let i = 0; i < text.length; i++) units.push(text.charCodeAt(i));
  const out = new Uint8Array(2 + units.length * 2 + 2);
  out[0] = 0xff; // BOM little-endian
  out[1] = 0xfe;
  units.forEach((unit, i) => {
    out[2 + i * 2] = unit & 0xff;
    out[3 + i * 2] = (unit >> 8) & 0xff;
  });
  // terminador nulo UTF-16 (los dos últimos bytes quedan en 0)
  return out;
}

/** Tamaño de frame en ID3v2.3: entero de 32 bits big-endian (no syncsafe). */
function beUint32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** Tamaño de la cabecera ID3: 4 bytes de 7 bits («syncsafe»). */
function syncSafe(value: number): number[] {
  return [(value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f];
}

function textFrame(id: string, text: string): Uint8Array | null {
  if (!text) return null;
  const encoded = utf16WithBom(text);
  const body = new Uint8Array(1 + encoded.length);
  body[0] = 0x01; // UTF-16 con BOM
  body.set(encoded, 1);

  const frame = new Uint8Array(10 + body.length);
  for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i);
  beUint32(body.length).forEach((byte, i) => (frame[4 + i] = byte));
  frame[8] = 0;
  frame[9] = 0;
  frame.set(body, 10);
  return frame;
}

/**
 * COMM lleva idioma y un descriptor corto antes del texto real.
 *
 * El descriptor vacío en UTF-16 son 4 bytes —BOM más terminador nulo—, no 2:
 * si se omite el terminador, los lectores toman el texto real como descriptor
 * y el comentario acaba con el valor vacío.
 */
function commentFrame(text: string, language = "spa"): Uint8Array | null {
  if (!text) return null;
  const encoded = utf16WithBom(text);
  const body = new Uint8Array(1 + 3 + 4 + encoded.length);
  body[0] = 0x01;
  for (let i = 0; i < 3; i++) body[1 + i] = language.charCodeAt(i);
  body[4] = 0xff; // BOM del descriptor
  body[5] = 0xfe;
  body[6] = 0x00; // terminador nulo del descriptor vacío
  body[7] = 0x00;
  body.set(encoded, 8);

  const frame = new Uint8Array(10 + body.length);
  "COMM".split("").forEach((ch, i) => (frame[i] = ch.charCodeAt(0)));
  beUint32(body.length).forEach((byte, i) => (frame[4 + i] = byte));
  frame.set(body, 10);
  return frame;
}

/** Construye la etiqueta ID3v2.3 completa lista para ir delante del MP3. */
export function buildId3Tag(tags: Id3Tags): Uint8Array {
  const frames = [
    textFrame("TIT2", tags.title),
    textFrame("TALB", tags.album || ""),
    textFrame("TPE1", tags.artist || ""),
    textFrame("TPE2", tags.albumArtist || tags.artist || ""),
    textFrame("TRCK", tags.track || ""),
    textFrame("TCON", tags.genre || ""),
    commentFrame(tags.comment || ""),
  ].filter((f): f is Uint8Array => f !== null);

  const bodySize = frames.reduce((sum, f) => sum + f.length, 0);
  const tag = new Uint8Array(10 + bodySize);
  tag[0] = 0x49; // I
  tag[1] = 0x44; // D
  tag[2] = 0x33; // 3
  tag[3] = 0x03; // versión mayor 3
  tag[4] = 0x00;
  tag[5] = 0x00; // sin flags
  syncSafe(bodySize).forEach((byte, i) => (tag[6 + i] = byte));

  let offset = 10;
  for (const frame of frames) {
    tag.set(frame, offset);
    offset += frame.length;
  }
  return tag;
}

/** Devuelve un nuevo Blob MP3 con la etiqueta ID3 delante. */
export function tagMp3(audio: Blob, tags: Id3Tags): Blob {
  const tag = buildId3Tag(tags);
  return new Blob([tag as BlobPart, audio], { type: "audio/mpeg" });
}
