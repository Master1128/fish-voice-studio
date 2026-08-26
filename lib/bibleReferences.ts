import type { BibleCitationSettings, BibleCitationStyle } from "./types";

interface BibleBook {
  spokenName: string;
  aliases: readonly string[];
}

const BOOKS: readonly BibleBook[] = [
  { spokenName: "Génesis", aliases: ["Génesis", "Genesis", "Gén", "Gen", "Gn"] },
  { spokenName: "Éxodo", aliases: ["Éxodo", "Exodo", "Éx", "Ex"] },
  { spokenName: "Levítico", aliases: ["Levítico", "Levitico", "Lev", "Lv"] },
  { spokenName: "Números", aliases: ["Números", "Numeros", "Núm", "Num", "Nm"] },
  { spokenName: "Deuteronomio", aliases: ["Deuteronomio", "Deut", "Dt"] },
  { spokenName: "Josué", aliases: ["Josué", "Josue", "Jos"] },
  { spokenName: "Jueces", aliases: ["Jueces", "Jue", "Jc"] },
  { spokenName: "Rut", aliases: ["Rut", "Rt"] },
  { spokenName: "Primera de Samuel", aliases: ["1 Samuel", "I Samuel", "Primera de Samuel", "Primer Samuel", "1 Sam", "1 Sa"] },
  { spokenName: "Segunda de Samuel", aliases: ["2 Samuel", "II Samuel", "Segunda de Samuel", "Segundo Samuel", "2 Sam", "2 Sa"] },
  { spokenName: "Primera de Reyes", aliases: ["1 Reyes", "I Reyes", "Primera de Reyes", "Primer Reyes", "1 Re", "1 Ry"] },
  { spokenName: "Segunda de Reyes", aliases: ["2 Reyes", "II Reyes", "Segunda de Reyes", "Segundo Reyes", "2 Re", "2 Ry"] },
  { spokenName: "Primera de Crónicas", aliases: ["1 Crónicas", "1 Cronicas", "I Crónicas", "I Cronicas", "Primera de Crónicas", "Primer Crónicas", "1 Crón", "1 Cron", "1 Cr"] },
  { spokenName: "Segunda de Crónicas", aliases: ["2 Crónicas", "2 Cronicas", "II Crónicas", "II Cronicas", "Segunda de Crónicas", "Segundo Crónicas", "2 Crón", "2 Cron", "2 Cr"] },
  { spokenName: "Esdras", aliases: ["Esdras", "Esd", "Es"] },
  { spokenName: "Nehemías", aliases: ["Nehemías", "Nehemias", "Neh", "Ne"] },
  { spokenName: "Tobías", aliases: ["Tobías", "Tobias", "Tob", "Tb"] },
  { spokenName: "Judit", aliases: ["Judit", "Jdt", "Jd"] },
  { spokenName: "Ester", aliases: ["Ester", "Est"] },
  { spokenName: "Primera de Macabeos", aliases: ["1 Macabeos", "I Macabeos", "Primera de Macabeos", "Primer Macabeos", "1 Mac", "1 M"] },
  { spokenName: "Segunda de Macabeos", aliases: ["2 Macabeos", "II Macabeos", "Segunda de Macabeos", "Segundo Macabeos", "2 Mac", "2 M"] },
  { spokenName: "Job", aliases: ["Job"] },
  { spokenName: "Salmos", aliases: ["Salmos", "Salmo", "Sal", "Sl"] },
  { spokenName: "Proverbios", aliases: ["Proverbios", "Prov", "Pr"] },
  { spokenName: "Eclesiastés", aliases: ["Eclesiastés", "Eclesiastes", "Ecl", "Qo"] },
  { spokenName: "Cantar de los Cantares", aliases: ["Cantar de los Cantares", "Cantares", "Cant", "Ct"] },
  { spokenName: "Sabiduría", aliases: ["Sabiduría", "Sabiduria", "Sab", "Sb"] },
  { spokenName: "Eclesiástico", aliases: ["Eclesiástico", "Eclesiastico", "Sirácida", "Siracida", "Eclo", "Sir"] },
  { spokenName: "Isaías", aliases: ["Isaías", "Isaias", "Isa", "Is"] },
  { spokenName: "Jeremías", aliases: ["Jeremías", "Jeremias", "Jer", "Jr"] },
  { spokenName: "Lamentaciones", aliases: ["Lamentaciones", "Lam", "Lm"] },
  { spokenName: "Baruc", aliases: ["Baruc", "Bar", "Ba"] },
  { spokenName: "Ezequiel", aliases: ["Ezequiel", "Ezeq", "Ez"] },
  { spokenName: "Daniel", aliases: ["Daniel", "Dan", "Dn"] },
  { spokenName: "Oseas", aliases: ["Oseas", "Os"] },
  { spokenName: "Joel", aliases: ["Joel", "Jl"] },
  { spokenName: "Amós", aliases: ["Amós", "Amos", "Am"] },
  { spokenName: "Abdías", aliases: ["Abdías", "Abdias", "Abd", "Ab"] },
  { spokenName: "Jonás", aliases: ["Jonás", "Jonas", "Jon"] },
  { spokenName: "Miqueas", aliases: ["Miqueas", "Miq", "Mi"] },
  { spokenName: "Nahúm", aliases: ["Nahúm", "Nahum", "Nah", "Na"] },
  { spokenName: "Habacuc", aliases: ["Habacuc", "Hab", "Ha"] },
  { spokenName: "Sofonías", aliases: ["Sofonías", "Sofonias", "Sof", "So"] },
  { spokenName: "Ageo", aliases: ["Ageo", "Ag"] },
  { spokenName: "Zacarías", aliases: ["Zacarías", "Zacarias", "Zac", "Za"] },
  { spokenName: "Malaquías", aliases: ["Malaquías", "Malaquias", "Mal", "Ml"] },
  { spokenName: "Mateo", aliases: ["Mateo", "Mat", "Mt"] },
  { spokenName: "Marcos", aliases: ["Marcos", "Marc", "Mc"] },
  { spokenName: "Lucas", aliases: ["Lucas", "Luc", "Lc"] },
  { spokenName: "Juan", aliases: ["Juan", "Jn"] },
  { spokenName: "Hechos", aliases: ["Hechos de los Apóstoles", "Hechos", "Hch", "Hc"] },
  { spokenName: "Romanos", aliases: ["Romanos", "Rom", "Ro"] },
  { spokenName: "Primera a los Corintios", aliases: ["1 Corintios", "I Corintios", "Primera a los Corintios", "Primer Corintios", "1 Cor", "1 Co"] },
  { spokenName: "Segunda a los Corintios", aliases: ["2 Corintios", "II Corintios", "Segunda a los Corintios", "Segundo Corintios", "2 Cor", "2 Co"] },
  { spokenName: "Gálatas", aliases: ["Gálatas", "Galatas", "Gál", "Gal"] },
  { spokenName: "Efesios", aliases: ["Efesios", "Efe", "Ef"] },
  { spokenName: "Filipenses", aliases: ["Filipenses", "Flp", "Fil"] },
  { spokenName: "Colosenses", aliases: ["Colosenses", "Col"] },
  { spokenName: "Primera a los Tesalonicenses", aliases: ["1 Tesalonicenses", "I Tesalonicenses", "Primera a los Tesalonicenses", "Primer Tesalonicenses", "1 Tes", "1 Ts"] },
  { spokenName: "Segunda a los Tesalonicenses", aliases: ["2 Tesalonicenses", "II Tesalonicenses", "Segunda a los Tesalonicenses", "Segundo Tesalonicenses", "2 Tes", "2 Ts"] },
  { spokenName: "Primera a Timoteo", aliases: ["1 Timoteo", "I Timoteo", "Primera a Timoteo", "Primer Timoteo", "1 Tim", "1 Ti"] },
  { spokenName: "Segunda a Timoteo", aliases: ["2 Timoteo", "II Timoteo", "Segunda a Timoteo", "Segundo Timoteo", "2 Tim", "2 Ti"] },
  { spokenName: "Tito", aliases: ["Tito", "Tit"] },
  { spokenName: "Filemón", aliases: ["Filemón", "Filemon", "Flm", "Filem"] },
  { spokenName: "Hebreos", aliases: ["Hebreos", "Heb"] },
  { spokenName: "Santiago", aliases: ["Santiago", "Sant", "Stg", "St"] },
  { spokenName: "Primera de Pedro", aliases: ["1 Pedro", "I Pedro", "Primera de Pedro", "Primer Pedro", "1 Pe", "1 Ped"] },
  { spokenName: "Segunda de Pedro", aliases: ["2 Pedro", "II Pedro", "Segunda de Pedro", "Segundo Pedro", "2 Pe", "2 Ped"] },
  { spokenName: "Primera de Juan", aliases: ["1 Juan", "I Juan", "Primera de Juan", "Primer Juan", "1 Jn"] },
  { spokenName: "Segunda de Juan", aliases: ["2 Juan", "II Juan", "Segunda de Juan", "Segundo Juan", "2 Jn"] },
  { spokenName: "Tercera de Juan", aliases: ["3 Juan", "III Juan", "Tercera de Juan", "Tercer Juan", "3 Jn"] },
  { spokenName: "Judas", aliases: ["Judas", "Jud"] },
  { spokenName: "Apocalipsis", aliases: ["Apocalipsis", "Apoc", "Ap", "Revelación", "Revelacion"] },
] as const;

const UNITS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"] as const;
const SPECIAL: Record<number, string> = {
  10: "diez", 11: "once", 12: "doce", 13: "trece", 14: "catorce", 15: "quince",
  16: "dieciséis", 17: "diecisiete", 18: "dieciocho", 19: "diecinueve",
  20: "veinte", 21: "veintiuno", 22: "veintidós", 23: "veintitrés", 24: "veinticuatro",
  25: "veinticinco", 26: "veintiséis", 27: "veintisiete", 28: "veintiocho", 29: "veintinueve",
};
const TENS = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"] as const;
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"] as const;

export function numberToSpanish(value: number): string {
  const n = Math.trunc(value);
  if (!Number.isFinite(n) || n < 0 || n > 999) return String(value);
  if (n < 10) return UNITS[n];
  if (SPECIAL[n]) return SPECIAL[n];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const unit = n % 10;
    return unit ? `${TENS[tens]} y ${UNITS[unit]}` : TENS[tens];
  }
  if (n === 100) return "cien";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return rest ? `${HUNDREDS[hundreds]} ${numberToSpanish(rest)}` : HUNDREDS[hundreds];
}

function normalizeAlias(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ALIAS_TO_BOOK = new Map<string, BibleBook>();
const ALIAS_PATTERN = BOOKS.flatMap((book) =>
  book.aliases.map((alias) => {
    ALIAS_TO_BOOK.set(normalizeAlias(alias), book);
    return escapeRegex(alias).replace(/\\ /g, "\\s+") + "\\.?";
  })
)
  .sort((a, b) => b.length - a.length)
  .join("|");

const VERSE_ITEM = String.raw`\d{1,3}(?:\s*[-–—]\s*\d{1,3})?`;
const VERSE_LIST = String.raw`${VERSE_ITEM}(?:\s*(?:,|\by\b)\s*${VERSE_ITEM})*`;
const CHAPTER_GROUP = String.raw`\d{1,3}\s*:\s*${VERSE_LIST}`;
const CITATION_PATTERN = new RegExp(
  String.raw`(^|[^\p{L}\p{N}])(${ALIAS_PATTERN})\s+(${CHAPTER_GROUP}(?:\s*;\s*${CHAPTER_GROUP})*)`,
  "giu"
);

interface VerseItem {
  from: number;
  to?: number;
}

function parseVerseList(value: string): VerseItem[] {
  return value
    .split(/\s*(?:,|\by\b)\s*/iu)
    .map((part) => {
      const [from, to] = part.split(/\s*[-–—]\s*/).map(Number);
      return { from, ...(to != null && Number.isFinite(to) ? { to } : {}) };
    })
    .filter((item) => item.from > 0 && item.from <= 999 && (item.to == null || (item.to > 0 && item.to <= 999)));
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} y ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

function speakVerseItem(item: VerseItem): string {
  const from = numberToSpanish(item.from);
  return item.to != null ? `${from} al ${numberToSpanish(item.to)}` : from;
}

function formatChapterGroup(group: string, style: BibleCitationStyle): string | null {
  const match = group.match(/^\s*(\d{1,3})\s*:\s*(.+?)\s*$/u);
  if (!match) return null;
  const chapter = Number(match[1]);
  if (chapter <= 0 || chapter > 999) return null;
  const verses = parseVerseList(match[2]);
  if (!verses.length) return null;
  const spokenVerses = joinNatural(verses.map(speakVerseItem));
  if (style === "compact") return `${numberToSpanish(chapter)}, ${spokenVerses}`;
  const label = verses.length === 1 && verses[0].to == null ? "versículo" : "versículos";
  return `capítulo ${numberToSpanish(chapter)}, ${label} ${spokenVerses}`;
}

export function normalizeBibleReferences(
  text: string,
  settings: BibleCitationSettings
): string {
  if (!settings.enabled || !text.trim()) return text;
  const style: BibleCitationStyle = settings.style === "narrated" ? "narrated" : "compact";

  return text.replace(CITATION_PATTERN, (full, prefix: string, rawBook: string, rawGroups: string) => {
    const book = ALIAS_TO_BOOK.get(normalizeAlias(rawBook));
    if (!book) return full;
    const groups = rawGroups.split(/\s*;\s*/).map((group) => formatChapterGroup(group, style));
    if (groups.some((group) => !group)) return full;
    return `${prefix}${book.spokenName}, ${groups.join("; ")}`;
  });
}
