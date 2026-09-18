import { describe, expect, it } from "vitest";
import {
  collectElements,
  estimateSeconds,
  formatDuration,
  looksLikeList,
  parseEpub,
  resolvePath,
  safeFileName,
} from "./epub";
import { cleanBookText, decodeEntities, htmlToText } from "./epubText";

const encoder = new TextEncoder();

function entries(files: Record<string, string>): Map<string, Uint8Array> {
  return new Map(Object.entries(files).map(([k, v]) => [k, encoder.encode(v)]));
}

const CONTAINER = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const body = (text: string) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>${text}</body></html>`;

const LONG = "Texto suficientemente largo para que cuente como capítulo de verdad. ".repeat(4);

describe("htmlToText", () => {
  it("separa párrafos con línea en blanco para que splitLongText los respete", () => {
    const out = htmlToText(body("<p>Primero.</p><p>Segundo.</p>"));
    expect(out).toBe("Primero.\n\nSegundo.");
  });

  it("descarta notas al pie, marcadores sup y números de página", () => {
    const html = body(
      `<p>Palabra<sup><a epub:type="noteref" href="#n1">1</a></sup> final.</p>` +
        `<span epub:type="pagebreak" id="p12">12</span>` +
        `<aside epub:type="footnote"><p>Una nota que no debe leerse.</p></aside>`
    );
    const out = htmlToText(html);
    expect(out).toContain("Palabra final.");
    expect(out).not.toContain("no debe leerse");
    expect(out).not.toContain("12");
  });

  it("ignora script, style y contenido oculto", () => {
    const out = htmlToText(
      body(`<style>p{color:red}</style><script>var a=1;</script><div hidden>oculto</div><p>Visible.</p>`)
    );
    expect(out).toBe("Visible.");
  });

  it("convierte <br> en salto de línea simple", () => {
    expect(htmlToText(body("<p>Uno<br/>Dos</p>"))).toBe("Uno\nDos");
  });

  it("no se rompe con un > dentro de un atributo", () => {
    expect(htmlToText(body(`<p title="a > b">Texto.</p>`))).toBe("Texto.");
  });

  it("descarta comentarios y conserva CDATA", () => {
    expect(htmlToText(body("<p>A<!-- nota interna -->B</p>"))).toBe("AB");
  });

  it("tolera una etiqueta sin cerrar al final", () => {
    expect(htmlToText("<p>Final.</p><p")).toBe("Final.");
  });

  it("no pierde texto cuando cierra una etiqueta que nunca se abrió", () => {
    expect(htmlToText("Hola</em> mundo")).toBe("Hola mundo");
  });
});

describe("decodeEntities", () => {
  it("resuelve entidades con nombre, decimales y hexadecimales", () => {
    expect(decodeEntities("Ma&ntilde;ana &amp; &#191;qu&eacute;? &#x2014; fin")).toBe(
      "Mañana & ¿qué? — fin"
    );
  });

  it("deja intacta una entidad desconocida", () => {
    expect(decodeEntities("&noexiste; y &amp;")).toBe("&noexiste; y &");
  });
});

describe("cleanBookText", () => {
  it("quita guiones suaves y líneas de adorno o número de página", () => {
    const input = "Pala­bra partida.\n\n14\n\n* * *\n\nSigue el texto.";
    const out = cleanBookText(input);
    expect(out).toContain("Palabra partida.");
    expect(out).toContain("Sigue el texto.");
    expect(out).not.toMatch(/^14$/m);
    expect(out).not.toContain("* * *");
  });

  it("borra numerales romanos sueltos pero no palabras hechas con esas letras", () => {
    const out = cleanBookText("XIV\n\ncivil\n\nmil\n\nTexto normal del capítulo.");
    expect(out).not.toMatch(/^XIV$/m);
    expect(out).toMatch(/^civil$/m);
    expect(out).toMatch(/^mil$/m);
  });

  it("conserva la línea en blanco que separa párrafos", () => {
    expect(cleanBookText("Uno.\n\nDos.")).toBe("Uno.\n\nDos.");
  });
});

describe("resolvePath", () => {
  it("resuelve rutas relativas, ./ y ../", () => {
    expect(resolvePath("OEBPS", "ch1.xhtml")).toBe("OEBPS/ch1.xhtml");
    expect(resolvePath("OEBPS/text", "../images/a.png")).toBe("OEBPS/images/a.png");
    expect(resolvePath("OEBPS", "./ch2.xhtml#frag")).toBe("OEBPS/ch2.xhtml");
    expect(resolvePath("OEBPS", "cap%C3%ADtulo.xhtml")).toBe("OEBPS/capítulo.xhtml");
  });

  it("no revienta con un % mal codificado", () => {
    expect(resolvePath("OEBPS", "100%.xhtml")).toBe("OEBPS/100%.xhtml");
  });
});

describe("collectElements", () => {
  it("respeta el anidamiento del mismo nombre", () => {
    const found = collectElements("<a><a>interno</a>externo</a>", "a");
    expect(found).toHaveLength(1);
    expect(found[0].inner).toBe("<a>interno</a>externo");
  });
});

describe("parseEpub", () => {
  const epub2 = {
    "META-INF/container.xml": CONTAINER,
    "OEBPS/content.opf": `<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>El nombre del libro</dc:title>
        <dc:creator>Autora Ejemplo</dc:creator>
        <dc:language>es</dc:language>
      </metadata>
      <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
        <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
        <item id="img" href="cover.jpg" media-type="image/jpeg"/>
      </manifest>
      <spine toc="ncx">
        <itemref idref="cover"/>
        <itemref idref="c1"/>
        <itemref idref="c2"/>
      </spine>
    </package>`,
    "OEBPS/toc.ncx": `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
      <navMap>
        <navPoint><navLabel><text>Primera parte</text></navLabel><content src="text/ch1.xhtml"/></navPoint>
        <navPoint><navLabel><text>Segunda parte</text></navLabel><content src="text/ch2.xhtml#inicio"/></navPoint>
      </navMap>
    </ncx>`,
    "OEBPS/cover.xhtml": body(`<img src="cover.jpg" alt=""/>`),
    "OEBPS/text/ch1.xhtml": body(`<h1>Uno</h1><p>${LONG}</p>`),
    "OEBPS/text/ch2.xhtml": body(`<h1>Dos</h1><p>${LONG}</p>`),
  };

  it("lee metadatos, orden del spine y títulos del NCX", () => {
    const book = parseEpub(entries(epub2));
    expect(book.title).toBe("El nombre del libro");
    expect(book.author).toBe("Autora Ejemplo");
    expect(book.language).toBe("es");
    expect(book.chapters.map((c) => c.title)).toEqual(["Primera parte", "Segunda parte"]);
    expect(book.chapters[0].chars).toBeGreaterThan(120);
    expect(book.chapters[0].words).toBeGreaterThan(0);
  });

  it("descarta la portada sin texto y la cuenta como omitida", () => {
    const book = parseEpub(entries(epub2));
    expect(book.chapters.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(book.skipped).toBe(1);
  });

  it("lee títulos del nav de EPUB 3 y no lee el índice en voz alta", () => {
    const epub3 = {
      "META-INF/container.xml": CONTAINER,
      "OEBPS/content.opf": `<package version="3.0">
        <metadata><dc:title>Libro tres</dc:title><dc:language>es</dc:language></metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
          <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="nav"/><itemref idref="c1"/></spine>
      </package>`,
      "OEBPS/nav.xhtml": body(
        `<nav epub:type="toc"><ol><li><a href="ch1.xhtml">Capítulo bonito</a></li></ol></nav>`
      ),
      "OEBPS/ch1.xhtml": body(`<p>${LONG}</p>`),
    };
    const book = parseEpub(entries(epub3));
    expect(book.chapters).toHaveLength(1);
    expect(book.chapters[0].title).toBe("Capítulo bonito");
  });

  it("marca como paratexto lo que el índice no lista, cuando el índice es fiable", () => {
    // Reproduce la forma de los EPUB de Calibre: el NCX solo cubre capítulos
    // reales y el spine arrastra portadilla, créditos, colección e índice.
    const files: Record<string, string> = {
      "META-INF/container.xml": CONTAINER,
      "OEBPS/content.opf": `<package version="2.0">
        <metadata><dc:title>Libro Calibre</dc:title></metadata>
        <manifest>
          <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
          <item id="f0" href="split_000.html" media-type="application/xhtml+xml"/>
          <item id="f1" href="split_001.html" media-type="application/xhtml+xml"/>
          <item id="c1" href="split_005.html" media-type="application/xhtml+xml"/>
          <item id="c2" href="split_006.html" media-type="application/xhtml+xml"/>
          <item id="c3" href="split_007.html" media-type="application/xhtml+xml"/>
        </manifest>
        <spine toc="ncx">
          <itemref idref="f0"/><itemref idref="f1"/>
          <itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/>
        </spine>
      </package>`,
      "OEBPS/toc.ncx": `<ncx><navMap>
        <navPoint><navLabel><text>1. Uno</text></navLabel><content src="split_005.html"/></navPoint>
        <navPoint><navLabel><text>2. Dos</text></navLabel><content src="split_006.html"/></navPoint>
        <navPoint><navLabel><text>3. Tres</text></navLabel><content src="split_007.html"/></navPoint>
      </navMap></ncx>`,
      // Créditos y lista de la colección: largos, así que el filtro por
      // longitud no los atrapa
      "OEBPS/split_000.html": body(`<h1>Capítulo 3</h1><p>${LONG}</p>`),
      "OEBPS/split_001.html": body(`<p>${LONG}</p>`),
      "OEBPS/split_005.html": body(`<p>${LONG}</p>`),
      "OEBPS/split_006.html": body(`<p>${LONG}</p>`),
      "OEBPS/split_007.html": body(`<p>${LONG}</p>`),
    };
    const book = parseEpub(entries(files));
    expect(book.chapters).toHaveLength(5); // no se borra nada
    const frontMatter = book.chapters.filter((c) => c.likelyFrontMatter).map((c) => c.id);
    expect(frontMatter).toEqual(["f0", "f1"]);
    expect(book.chapters.filter((c) => c.inToc).map((c) => c.title)).toEqual([
      "1. Uno",
      "2. Dos",
      "3. Tres",
    ]);
  });

  it("con un índice corto no descarta nada por no estar listado", () => {
    // epub2 tiene solo 2 entradas de NCX: no basta para decidir qué es paratexto
    const book = parseEpub(entries(epub2));
    expect(book.chapters.every((c) => !c.likelyFrontMatter)).toBe(true);
  });

  it("sin índice, reconoce el paratexto por título y por ruta", () => {
    const files: Record<string, string> = {
      "META-INF/container.xml": CONTAINER,
      "OEBPS/content.opf": `<package version="2.0">
        <metadata><dc:title>Sin índice</dc:title></metadata>
        <manifest>
          <item id="a" href="copyright.xhtml" media-type="application/xhtml+xml"/>
          <item id="b" href="p2.xhtml" media-type="application/xhtml+xml"/>
          <item id="c" href="p3.xhtml" media-type="application/xhtml+xml"/>
          <item id="d" href="index.html" media-type="application/xhtml+xml"/>
        </manifest>
        <spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/><itemref idref="d"/></spine>
      </package>`,
      "OEBPS/copyright.xhtml": body(`<p>${LONG}</p>`),
      "OEBPS/p2.xhtml": body(`<h1>Índice</h1><p>${LONG}</p>`),
      "OEBPS/p3.xhtml": body(`<h1>Capítulo primero</h1><p>${LONG}</p>`),
      // `index.html` NO debe contar como paratexto: Calibre sirve libros ahí
      "OEBPS/index.html": body(`<h1>Capítulo segundo</h1><p>${LONG}</p>`),
    };
    const book = parseEpub(entries(files));
    const byId = Object.fromEntries(book.chapters.map((c) => [c.id, c.likelyFrontMatter]));
    expect(byId).toEqual({ a: true, b: true, c: false, d: false });
  });

  it("omite los itemref con linear=no", () => {
    const files = {
      ...epub2,
      "OEBPS/content.opf": epub2["OEBPS/content.opf"].replace(
        '<itemref idref="c2"/>',
        '<itemref idref="c2" linear="no"/>'
      ),
    };
    expect(parseEpub(entries(files)).chapters.map((c) => c.id)).toEqual(["c1"]);
  });

  it("cae al primer encabezado cuando no hay índice", () => {
    const files: Record<string, string> = { ...epub2 };
    delete files["OEBPS/toc.ncx"];
    expect(parseEpub(entries(files)).chapters.map((c) => c.title)).toEqual(["Uno", "Dos"]);
  });

  it("encuentra el .opf aunque el container.xml sea inservible", () => {
    const files = { ...epub2, "META-INF/container.xml": "<container/>" };
    expect(parseEpub(entries(files)).chapters).toHaveLength(2);
  });

  it("falla con mensaje claro si no hay paquete ni capítulos", () => {
    expect(() => parseEpub(entries({ "mimetype": "application/epub+zip" }))).toThrow(/\.opf/);
    const sinTexto = {
      ...epub2,
      "OEBPS/text/ch1.xhtml": body("<p>corto</p>"),
      "OEBPS/text/ch2.xhtml": body("<p>corto</p>"),
    };
    expect(() => parseEpub(entries(sinTexto))).toThrow(/texto legible/);
  });
});

describe("looksLikeList", () => {
  const nombres = [
    "Adoniram Judson", "Amy Carmichael", "Betty Greene", "Hermano Andrés",
    "Cameron Townsend", "Clarence Jones", "Corrie ten Boom", "C. S. Lewis",
    "David Livingstone", "George Müller", "Gladys Aylward", "Hudson Taylor",
  ].join("\n\n");

  it("reconoce la lista de la colección y un índice de capítulos", () => {
    expect(looksLikeList(nombres)).toBe(true);
    const indice = Array.from({ length: 14 }, (_, i) => `Capítulo ${i + 1}`).join("\n\n");
    expect(looksLikeList(indice)).toBe(true);
  });

  it("no confunde prosa con una lista", () => {
    const prosa = Array.from(
      { length: 14 },
      (_, i) =>
        `Este es el párrafo número ${i + 1} de un capítulo de verdad, con frases completas que terminan en punto.`
    ).join("\n\n");
    expect(looksLikeList(prosa)).toBe(false);
  });

  it("no marca como lista un fragmento corto de diálogo", () => {
    expect(looksLikeList("—Ven aquí\n\n—No quiero\n\n—Vamos")).toBe(false);
  });
});

describe("safeFileName", () => {
  it("elimina separadores y caracteres prohibidos conservando acentos", () => {
    expect(safeFileName('Cap/ítulo: "uno"?')).toBe("Cap ítulo uno");
  });

  it("nunca devuelve cadena vacía ni termina en punto", () => {
    expect(safeFileName("///")).toBe("sin-titulo");
    expect(safeFileName("Fin...")).toBe("Fin");
  });
});

describe("estimateSeconds / formatDuration", () => {
  it("estima con la velocidad de lectura y la acelera", () => {
    expect(Math.round(estimateSeconds(155))).toBe(60);
    expect(Math.round(estimateSeconds(155, 2))).toBe(30);
  });

  it("formatea horas, minutos y segundos", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(125)).toBe("2 min 05 s");
    expect(formatDuration(3725)).toBe("1 h 02 min");
  });
});
