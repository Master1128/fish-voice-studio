import { describe, expect, it } from "vitest";
import {
  assignBookFolders,
  bookFolderName,
  bookKeyFor,
  chapterFileName,
  mapWithConcurrency,
} from "./bookJob";
import type { EpubBook } from "./epub";

const book: EpubBook = {
  title: "El nombre del libro",
  author: "Autora",
  language: "es",
  chapters: [],
  skipped: 0,
};

describe("chapterFileName", () => {
  it("rellena con ceros según el total para que el orden alfabético sea el correcto", () => {
    expect(chapterFileName(3, 17, "Título")).toBe("03 - Título.mp3");
    expect(chapterFileName(7, 120, "Título")).toBe("007 - Título.mp3");
    expect(chapterFileName(1, 9, "Título")).toBe("01 - Título.mp3");
  });

  it("ordena bien en un libro de más de cien capítulos", () => {
    const names = [chapterFileName(2, 150, "b"), chapterFileName(11, 150, "a")];
    expect([...names].sort()).toEqual(names);
  });

  it("neutraliza los caracteres que romperían la ruta", () => {
    expect(chapterFileName(1, 2, 'Cap/ítulo: "uno"')).toBe("01 - Cap ítulo uno.mp3");
  });
});

describe("bookFolderName", () => {
  it("usa «Autor - Título» y cae al título solo si no hay autor", () => {
    expect(bookFolderName({ title: "Manos que ayudan", author: "Janet Benge" })).toBe(
      "Janet Benge - Manos que ayudan"
    );
    expect(bookFolderName({ title: "Sin autor", author: "" })).toBe("Sin autor");
  });

  it("neutraliza los caracteres que romperían la ruta", () => {
    expect(bookFolderName({ title: "Tomo 1/2", author: "A: B" })).toBe("A B - Tomo 1 2");
  });

  it("dos libros distintos no comparten carpeta", () => {
    const a = bookFolderName({ title: "Helping Hands", author: "Janet Benge" });
    const b = bookFolderName({ title: "Joyful Surrender", author: "Janet Benge" });
    expect(a).not.toBe(b);
  });
});

describe("assignBookFolders", () => {
  const item = (title: string, author: string, fileName: string) => ({
    book: { title, author },
    fileName,
  });

  it("deja el nombre normal cuando no hay colisión", () => {
    expect(
      assignBookFolders([
        item("Helping Hands", "Janet Benge", "a.epub"),
        item("Joyful Surrender", "Janet Benge", "b.epub"),
      ])
    ).toEqual(["Janet Benge - Helping Hands", "Janet Benge - Joyful Surrender"]);
  });

  it("desempata con el nombre de archivo dos libros de igual título y autor", () => {
    // Caso real: la traducción y el original traen los mismos metadatos, y sin
    // esto escribirían los capítulos en la misma carpeta, sobreescribiéndose.
    const out = assignBookFolders([
      item("Helping Hands", "Janet Benge", "Manos que ayudan (ES).epub"),
      item("Helping Hands", "Janet Benge", "Helping Hands (EN).epub"),
    ]);
    expect(out[0]).toBe("Janet Benge - Helping Hands");
    expect(out[1]).toBe("Janet Benge - Helping Hands (Helping Hands (EN))");
    expect(new Set(out).size).toBe(2);
  });

  it("nunca repite carpeta, ni con muchos archivos de igual nombre", () => {
    const out = assignBookFolders(
      Array.from({ length: 6 }, () => item("Mismo", "Autor", "igual.epub"))
    );
    expect(new Set(out).size).toBe(6);
  });
});

describe("mapWithConcurrency", () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("devuelve los resultados en orden de índice, no de finalización", async () => {
    // El primero tarda más que todos: si el orden dependiera de cuándo acaba
    // cada uno, el audio del capítulo saldría descolocado.
    const finishOrder: number[] = [];
    const out = await mapWithConcurrency(6, 3, async (i) => {
      await wait(i === 0 ? 40 : 1);
      finishOrder.push(i);
      return i * 10;
    });
    expect(out).toEqual([0, 10, 20, 30, 40, 50]);
    expect(finishOrder[0]).not.toBe(0); // se confirma que sí terminaron desordenados
  });

  it("nunca supera el límite de tareas en vuelo", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(12, 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await wait(5);
      inFlight -= 1;
    });
    expect(peak).toBe(3);
  });

  it("con concurrencia 1 es estrictamente secuencial", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(5, 1, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await wait(2);
      inFlight -= 1;
    });
    expect(peak).toBe(1);
  });

  it("propaga el error de cualquier tarea", async () => {
    await expect(
      mapWithConcurrency(6, 3, async (i) => {
        if (i === 4) throw new Error("fragmento 4 falló");
        return i;
      })
    ).rejects.toThrow("fragmento 4 falló");
  });

  it("no lanza más trabajadores que tareas", async () => {
    expect(await mapWithConcurrency(2, 8, async (i) => i)).toEqual([0, 1]);
    expect(await mapWithConcurrency(0, 4, async (i) => i)).toEqual([]);
  });
});

describe("bookKeyFor", () => {
  const file = (name: string, size: number) =>
    ({ name, size }) as File;

  it("es estable para el mismo libro y distinta para otro", () => {
    const a = bookKeyFor(file("libro.epub", 1234), book);
    expect(bookKeyFor(file("libro.epub", 1234), book)).toBe(a);
    expect(bookKeyFor(file("libro.epub", 9999), book)).not.toBe(a);
    expect(bookKeyFor(file("otro.epub", 1234), book)).not.toBe(a);
  });

  it("incluye el título en claro para que la clave sea legible", () => {
    expect(bookKeyFor(file("x.epub", 1), book)).toMatch(/^El nombre del libro-/);
  });
});
