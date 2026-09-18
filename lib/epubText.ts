/**
 * Extracción de texto legible desde el XHTML de un EPUB.
 *
 * Implementado a mano (sin DOMParser) por dos razones: funciona igual en el
 * navegador y en node —con lo que es testeable con vitest sin jsdom— y permite
 * descartar subárboles completos (notas al pie, números de página) que un
 * `innerText` arrastraría al audio.
 */

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Elementos cuyo contenido no se lee nunca. `sup` cae aquí porque en libros
 *  es casi siempre el marcador de una nota al pie («…palabra¹»). */
const DROP_CONTENT = new Set([
  "script", "style", "head", "title", "svg", "noscript", "sup", "rt", "rp",
]);

/** Separan párrafos: producen línea en blanco (lo que `splitLongText` usa
 *  para trocear por párrafo antes que por oración). */
const PARAGRAPH_TAGS = new Set([
  "p", "div", "section", "article", "blockquote", "li", "dd", "dt", "pre",
  "figcaption", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "aside", "header",
  "footer", "main", "nav", "hgroup", "address", "figure", "details", "summary",
  "ol", "ul", "dl", "table", "caption", "tbody", "thead", "tfoot", "body", "hr",
]);

/** Saltan de línea sin abrir párrafo. */
const LINE_TAGS = new Set(["br", "td", "th"]);

const SKIP_EPUB_TYPE = /(^|\s)(noteref|footnote|footnotes|rearnote|rearnotes|endnote|endnotes|pagebreak|page-break)(\s|$)/i;
const SKIP_ROLE = /(^|\s)(doc-noteref|doc-footnote|doc-endnote|doc-pagebreak)(\s|$)/i;
const SKIP_CLASS = /(^|[\s_-])(pagebreak|page-number|pagenum|folio|calibre_pb|noteref|footnote-ref)([\s_-]|$)/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", ndash: "–", mdash: "—", shy: "­",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  laquo: "«", raquo: "»", hellip: "…", middot: "·",
  bull: "•", deg: "°", eacute: "é", egrave: "è",
  aacute: "á", iacute: "í", oacute: "ó", uacute: "ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó",
  Uacute: "Ú", iquest: "¿", iexcl: "¡", ccedil: "ç",
  agrave: "à", ouml: "ö", auml: "ä", szlig: "ß",
  copy: "©", reg: "®", trade: "™", euro: "€",
  pound: "£", sect: "§", para: "¶", dagger: "†",
  Dagger: "‡", prime: "′", Prime: "″", oelig: "œ",
  emsp: " ", ensp: " ", thinsp: " ", zwj: "", zwnj: "", lrm: "", rlm: "",
};

export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named !== undefined ? named : match;
  });
}

export interface ParsedTag {
  name: string;
  attrs: Record<string, string>;
  isClose: boolean;
  selfClose: boolean;
}

/** Busca el `>` que cierra la etiqueta abierta en `start`, ignorando los que
 *  aparecen dentro de valores entrecomillados (`<a title="a > b">`). */
export function findTagEnd(source: string, start: number): number {
  let quote = "";
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

export function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[m[1].toLowerCase()] = decodeEntities(raw);
  }
  return attrs;
}

export function parseTag(source: string, lt: number, gt: number): ParsedTag {
  let body = source.slice(lt + 1, gt);
  const isClose = body.startsWith("/");
  if (isClose) body = body.slice(1);
  const selfClose = body.endsWith("/");
  if (selfClose) body = body.slice(0, -1);
  const sep = body.search(/\s/);
  const name = (sep < 0 ? body : body.slice(0, sep)).toLowerCase();
  const attrs = sep < 0 ? {} : parseAttrs(body.slice(sep));
  return { name, attrs, isClose, selfClose };
}

/** `true` si el subárbol de esta etiqueta es paratexto que no debe leerse. */
function shouldDropSubtree(tag: ParsedTag): boolean {
  if (DROP_CONTENT.has(tag.name)) return true;
  const epubType = tag.attrs["epub:type"] || tag.attrs["type"] || "";
  if (epubType && SKIP_EPUB_TYPE.test(epubType)) return true;
  const role = tag.attrs["role"] || "";
  if (role && SKIP_ROLE.test(role)) return true;
  const cls = tag.attrs["class"] || "";
  if (cls && SKIP_CLASS.test(cls)) return true;
  if (tag.attrs["hidden"] !== undefined) return true;
  return false;
}

/**
 * Convierte XHTML de capítulo en texto plano con párrafos separados por línea
 * en blanco. Descarta notas al pie, números de página y contenido oculto.
 */
export function htmlToText(html: string): string {
  const parts: string[] = [];
  const stack: string[] = [];
  /** Índice en `stack` del elemento que abrió el descarte; -1 = no descartando. */
  let dropDepth = -1;
  let i = 0;
  const n = html.length;

  const emit = (value: string) => {
    if (dropDepth < 0) parts.push(value);
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      emit(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i) emit(decodeEntities(html.slice(i, lt)));

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html.startsWith("<![CDATA[", lt)) {
      const end = html.indexOf("]]>", lt + 9);
      emit(html.slice(lt + 9, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt);
      i = end < 0 ? n : end + 1;
      continue;
    }

    const gt = findTagEnd(html, lt);
    // Etiqueta truncada al final del archivo: es marcado a medias, no texto
    if (gt < 0) break;
    const tag = parseTag(html, lt, gt);
    i = gt + 1;
    if (!tag.name) continue;

    if (tag.isClose) {
      const idx = stack.lastIndexOf(tag.name);
      if (idx >= 0) {
        stack.length = idx;
        if (dropDepth >= 0 && dropDepth >= stack.length) dropDepth = -1;
      }
      if (PARAGRAPH_TAGS.has(tag.name)) emit("\n\n");
      else if (LINE_TAGS.has(tag.name)) emit("\n");
      continue;
    }

    const isVoid = VOID_TAGS.has(tag.name) || tag.selfClose;
    if (!isVoid) {
      const drop = dropDepth < 0 && shouldDropSubtree(tag);
      stack.push(tag.name);
      if (drop) dropDepth = stack.length - 1;
    } else if (dropDepth < 0 && shouldDropSubtree(tag)) {
      continue; // elemento vacío descartable (p. ej. <span epub:type="pagebreak"/>)
    }

    if (PARAGRAPH_TAGS.has(tag.name)) emit("\n\n");
    else if (LINE_TAGS.has(tag.name)) emit("\n");
  }

  return normalizeWhitespace(parts.join(""));
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v   ]/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Línea que es solo un número de página o similar. */
const NOISE_DIGITS = /^[\d\s.,·–—-]{1,12}$/;

/** Línea que es solo un adorno tipográfico («* * *», «———», «~~~»). */
const NOISE_ORNAMENT = /^[*#·•~_\s\-–—=+.]{1,24}$/;

/**
 * Numeral romano estricto. Deliberadamente no es `[ivxlcdm]+`: eso borraría
 * una línea legítima como «civil» o «mil».
 */
const NOISE_ROMAN = /^(?=[mdclxvi])m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

function isNoiseLine(line: string): boolean {
  if (!line) return false; // las líneas en blanco separan párrafos: se conservan
  return NOISE_DIGITS.test(line) || NOISE_ORNAMENT.test(line) || NOISE_ROMAN.test(line);
}

/**
 * Limpieza final orientada a audio: quita guiones de división, números de
 * página sueltos y adornos que el TTS leería en voz alta.
 */
export function cleanBookText(text: string): string {
  const lines = text
    .replace(/­/g, "") // guión suave de justificación
    .split("\n")
    .filter((line) => !isNoiseLine(line.trim()));

  return normalizeWhitespace(lines.join("\n"));
}

/** Cuenta palabras para estimar duración del audio. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
