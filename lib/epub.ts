/**
 * Lectura de EPUB (2 y 3) a partir de las entradas ya descomprimidas del ZIP.
 *
 * `parseEpub` es puro: recibe un mapa ruta→bytes, así que se puede probar en
 * node sin navegador. La descompresión vive en `bookJob.ts`.
 */

import { cleanBookText, countWords, findTagEnd, htmlToText, parseTag } from "./epubText";

export interface EpubChapter {
  /** idref del spine, estable dentro del libro → sirve como clave de reanudación */
  id: string;
  /** ruta normalizada dentro del ZIP */
  href: string;
  title: string;
  text: string;
  chars: number;
  words: number;
  /** Aparece en el índice del libro (NCX o nav) */
  inToc: boolean;
  /**
   * Casi seguro paratexto: copyright, índice, lista de la colección…
   * No se elimina —un índice incompleto haría perder capítulos de verdad—
   * pero la UI lo deja desmarcado.
   */
  likelyFrontMatter: boolean;
}

export interface EpubBook {
  title: string;
  author: string;
  language: string;
  chapters: EpubChapter[];
  /** Capítulos detectados pero sin texto útil (portadas, créditos) */
  skipped: number;
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

// ---------- utilidades XML ----------

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

interface XmlElement {
  attrs: Record<string, string>;
  inner: string;
}

/** Todos los elementos con ese nombre local, con su contenido interno. */
export function collectElements(xml: string, wanted: string): XmlElement[] {
  const target = wanted.toLowerCase();
  const found: XmlElement[] = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (xml.startsWith("<!", lt) || xml.startsWith("<?", lt)) {
      const end = xml.indexOf(">", lt);
      i = end < 0 ? xml.length : end + 1;
      continue;
    }
    const gt = findTagEnd(xml, lt);
    if (gt < 0) break;
    const tag = parseTag(xml, lt, gt);
    i = gt + 1;
    if (tag.isClose || localName(tag.name) !== target) continue;
    if (tag.selfClose) {
      found.push({ attrs: tag.attrs, inner: "" });
      continue;
    }
    const close = findMatchingClose(xml, gt + 1, target);
    found.push({ attrs: tag.attrs, inner: xml.slice(gt + 1, close < 0 ? xml.length : close) });
    i = close < 0 ? xml.length : close;
  }
  return found;
}

/** Posición del `<` del cierre que corresponde a un elemento ya abierto. */
function findMatchingClose(xml: string, from: number, target: string): number {
  let depth = 1;
  let i = from;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) return -1;
    if (xml.startsWith("<!", lt) || xml.startsWith("<?", lt)) {
      const end = xml.indexOf(">", lt);
      i = end < 0 ? xml.length : end + 1;
      continue;
    }
    const gt = findTagEnd(xml, lt);
    if (gt < 0) return -1;
    const tag = parseTag(xml, lt, gt);
    if (localName(tag.name) === target && !tag.selfClose) {
      if (tag.isClose) {
        depth -= 1;
        if (depth === 0) return lt;
      } else {
        depth += 1;
      }
    }
    i = gt + 1;
  }
  return -1;
}

function firstElementText(xml: string, wanted: string): string {
  const el = collectElements(xml, wanted)[0];
  return el ? htmlToText(el.inner).replace(/\s+/g, " ").trim() : "";
}

// ---------- rutas ----------

/** Resuelve un href relativo contra el directorio de su documento. */
export function resolvePath(baseDir: string, href: string): string {
  let clean = href.split("#")[0].trim();
  if (!clean) return "";
  try {
    clean = decodeURIComponent(clean);
  } catch {
    // href con % literal no codificado: se usa tal cual
  }
  if (clean.startsWith("/")) return normalizeSegments(clean.slice(1).split("/"));
  const base = baseDir ? baseDir.split("/") : [];
  return normalizeSegments([...base, ...clean.split("/")]);
}

function normalizeSegments(segments: string[]): string {
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

// ---------- índice (TOC) ----------

/** NCX de EPUB 2: el orden es `<navLabel><text>` y después `<content src>`. */
function titlesFromNcx(ncx: string, baseDir: string): Map<string, string> {
  const titles = new Map<string, string>();
  let pendingLabel = "";
  let i = 0;
  while (i < ncx.length) {
    const lt = ncx.indexOf("<", i);
    if (lt < 0) break;
    if (ncx.startsWith("<!", lt) || ncx.startsWith("<?", lt)) {
      const end = ncx.indexOf(">", lt);
      i = end < 0 ? ncx.length : end + 1;
      continue;
    }
    const gt = findTagEnd(ncx, lt);
    if (gt < 0) break;
    const tag = parseTag(ncx, lt, gt);
    const name = localName(tag.name);
    if (!tag.isClose && name === "text" && !tag.selfClose) {
      const close = findMatchingClose(ncx, gt + 1, "text");
      pendingLabel = htmlToText(ncx.slice(gt + 1, close < 0 ? ncx.length : close))
        .replace(/\s+/g, " ")
        .trim();
      i = close < 0 ? ncx.length : close;
      continue;
    }
    if (!tag.isClose && name === "content" && tag.attrs.src) {
      const path = resolvePath(baseDir, tag.attrs.src);
      if (path && pendingLabel && !titles.has(path)) titles.set(path, pendingLabel);
    }
    i = gt + 1;
  }
  return titles;
}

/** Documento de navegación de EPUB 3. */
function titlesFromNav(nav: string, baseDir: string): Map<string, string> {
  const titles = new Map<string, string>();
  const navs = collectElements(nav, "nav");
  const toc = navs.find((n) => /toc/i.test(n.attrs["epub:type"] || n.attrs.type || "")) || navs[0];
  const scope = toc ? toc.inner : nav;
  for (const anchor of collectElements(scope, "a")) {
    const href = anchor.attrs.href;
    if (!href) continue;
    const path = resolvePath(baseDir, href);
    const label = htmlToText(anchor.inner).replace(/\s+/g, " ").trim();
    if (path && label && !titles.has(path)) titles.set(path, label);
  }
  return titles;
}

/** Último recurso: el primer encabezado del propio capítulo. */
function titleFromHeading(html: string): string {
  for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    const el = collectElements(html, level)[0];
    if (!el) continue;
    const label = htmlToText(el.inner).replace(/\s+/g, " ").trim();
    if (label) return label.slice(0, 120);
  }
  return "";
}

// ---------- parseo principal ----------

function readText(entries: Map<string, Uint8Array>, path: string): string {
  const bytes = entries.get(path);
  if (!bytes) return "";
  return new TextDecoder("utf-8").decode(bytes);
}

/** Longitud mínima para considerar que un documento del spine es un capítulo. */
const MIN_CHAPTER_CHARS = 120;

/**
 * Un índice con al menos esto se considera fiable como definición de qué es
 * capítulo. Por debajo (índices solo de partes) no se usa para descartar.
 */
const MIN_TOC_ENTRIES = 3;

/** Títulos que delatan paratexto, al principio o al final del libro. */
const FRONT_MATTER_HINT = new RegExp(
  "^(?:" +
    [
      "cubierta", "portada(?:illa)?", "portadilla", "cr[eé]ditos", "copyright",
      "derechos(?: de autor)?", "[ií]ndice(?: general)?", "contenidos?",
      "tabla de contenidos?", "contents", "table of contents",
      "dedicatoria", "dedication", "agradecimientos?", "acknowledg\\w*",
      "(?:sobre|acerca de) (?:el |la |los )?(?:autor|autora|autores)\\w*",
      "about the authors?", "authors?", "autores?",
      "nota (?:del?|de la) (?:autor|traductor|editor)\\w*",
      "t[ií]tulo", "title ?page", "colecci[oó]n", "otros (?:libros|t[ií]tulos)",
      "also (?:by|from)", "bibliograf[ií]a", "bibliography", "gloss?ari?[oy]",
      "ap[eé]ndices?", "appendix", "notas?(?: finales)?", "endnotes?",
      "gu[ií]a de estudio", "study guide", "lecturas? (?:recomendadas?|adicionales?)",
      "for further reading", "ywam\\b.*", "juventud con una misi[oó]n",
    ].join("|") +
    ")\\b",
  "i"
);

/**
 * Se exige separador alrededor del término: `index` o `toc` suelto daría falso
 * positivo en rutas legítimas (Calibre llega a servir el libro en `index.html`).
 */
const FRONT_MATTER_PATH =
  /(^|[/_-])(cover|title-?page|copyright|colophon|toc|nav|contents)([_-]|\.[a-z]+$|$)/i;

/**
 * Detecta páginas que son una lista, no prosa: índices, listas de la colección,
 * cronologías. Señal independiente del idioma y del nombre del archivo, que es
 * lo que hace falta cuando el índice del propio libro se lista a sí mismo.
 */
export function looksLikeList(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 10) return false;
  const avgLength = lines.reduce((sum, l) => sum + l.trim().length, 0) / lines.length;
  if (avgLength > 50) return false;
  const withTerminator = lines.filter((l) => /[.!?…:]["»”']?$/.test(l.trim())).length;
  return withTerminator / lines.length < 0.2;
}

function looksLikeFrontMatter(title: string, href: string, text: string): boolean {
  return FRONT_MATTER_HINT.test(title.trim()) || FRONT_MATTER_PATH.test(href) || looksLikeList(text);
}

export function parseEpub(entries: Map<string, Uint8Array>): EpubBook {
  const container = readText(entries, "META-INF/container.xml");
  let opfPath = collectElements(container, "rootfile")[0]?.attrs["full-path"] || "";
  if (opfPath) opfPath = resolvePath("", opfPath);
  if (!opfPath || !entries.has(opfPath)) {
    // Algunos EPUB mal empaquetados no traen un container.xml usable
    opfPath = [...entries.keys()].find((k) => k.toLowerCase().endsWith(".opf")) || "";
  }
  if (!opfPath) throw new Error("No es un EPUB válido: falta el archivo .opf del paquete");

  const opf = readText(entries, opfPath);
  const opfDir = dirOf(opfPath);

  const metadataXml = collectElements(opf, "metadata")[0]?.inner || opf;
  const title = firstElementText(metadataXml, "title") || "Libro sin título";
  const author = firstElementText(metadataXml, "creator");
  const language = (firstElementText(metadataXml, "language") || "es").slice(0, 5);

  const manifest = new Map<string, ManifestItem>();
  const manifestXml = collectElements(opf, "manifest")[0]?.inner || opf;
  for (const el of collectElements(manifestXml, "item")) {
    const id = el.attrs.id;
    const href = el.attrs.href;
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href: resolvePath(opfDir, href),
      mediaType: (el.attrs["media-type"] || "").toLowerCase(),
      properties: el.attrs.properties || "",
    });
  }

  // Títulos: se prefiere el índice del libro; si no hay, el encabezado del capítulo
  let titles = new Map<string, string>();
  const navItem = [...manifest.values()].find((it) => /(^|\s)nav(\s|$)/.test(it.properties));
  if (navItem && entries.has(navItem.href)) {
    titles = titlesFromNav(readText(entries, navItem.href), dirOf(navItem.href));
  }
  if (titles.size === 0) {
    const spineEl = collectElements(opf, "spine")[0];
    const ncxId = spineEl?.attrs.toc;
    const ncxItem =
      (ncxId && manifest.get(ncxId)) ||
      [...manifest.values()].find(
        (it) => it.mediaType.includes("dtbncx") || it.href.toLowerCase().endsWith(".ncx")
      );
    if (ncxItem && entries.has(ncxItem.href)) {
      titles = titlesFromNcx(readText(entries, ncxItem.href), dirOf(ncxItem.href));
    }
  }

  const hasUsableToc = titles.size >= MIN_TOC_ENTRIES;
  const spine = collectElements(opf, "spine")[0]?.inner || "";
  const chapters: EpubChapter[] = [];
  let skipped = 0;
  let index = 0;

  for (const ref of collectElements(spine, "itemref")) {
    const item = ref.attrs.idref ? manifest.get(ref.attrs.idref) : undefined;
    if (!item) continue;
    if (ref.attrs.linear === "no") continue;
    if (navItem && item.id === navItem.id) continue; // no leer el índice en voz alta
    if (item.mediaType && !item.mediaType.includes("html")) continue;
    const html = readText(entries, item.href);
    if (!html) continue;

    index += 1;
    const text = cleanBookText(htmlToText(html));
    if (text.length < MIN_CHAPTER_CHARS) {
      skipped += 1; // portada, dedicatoria, página de créditos sin texto
      continue;
    }
    const inToc = titles.has(item.href);
    const title = titles.get(item.href) || titleFromHeading(html) || `Capítulo ${index}`;
    chapters.push({
      id: item.id,
      href: item.href,
      title,
      text,
      chars: text.length,
      words: countWords(text),
      inToc,
      // Tres señales independientes, porque ninguna basta sola: con un índice
      // fiable, lo que no está en él es paratexto (los EPUB de Calibre dejan
      // portadilla y créditos en el spine); pero hay índices que se listan a
      // sí mismos, y ahí sirven el nombre y la forma del texto.
      likelyFrontMatter:
        (hasUsableToc && !inToc) || looksLikeFrontMatter(title, item.href, text),
    });
  }

  if (chapters.length === 0) {
    throw new Error("El EPUB no contiene capítulos con texto legible");
  }

  return { title, author, language, chapters, skipped };
}

/**
 * Nombre de archivo seguro para cualquier sistema de archivos.
 *
 * Tolera valores ausentes a propósito: se llama con metadatos de EPUB y con
 * estado de la interfaz, y que una recarga en caliente o un EPUB sin título
 * tumben una tanda de horas con un «cannot read properties of undefined» no
 * es aceptable. Mejor un nombre soso que un fallo.
 */
export function safeFileName(input: string | null | undefined, maxLength = 80): string {
  const cleaned = String(input ?? "")
    .normalize("NFC")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/[ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return (cleaned || "sin-titulo").slice(0, maxLength);
}

/** Duración estimada del audio en segundos (≈155 palabras por minuto). */
export function estimateSeconds(words: number, speed = 1): number {
  return ((words / 155) * 60) / (speed || 1);
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m > 0) return `${m} min ${String(s).padStart(2, "0")} s`;
  return `${s} s`;
}
