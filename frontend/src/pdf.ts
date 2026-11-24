// Extracción de texto de un CV en PDF, en el navegador (sin enviar el archivo a ningún servidor).
// §5.3 recomendación 9: permitir subir un PDF y volcar su texto al perfil.
import * as pdfjsLib from "pdfjs-dist";
// Vite sirve el worker como asset con ?url; así no se empaqueta inline.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

/** Devuelve el texto del PDF, una línea por renglón detectado (hasEOL). */
export async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const lines: string[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let current = "";
      for (const item of content.items as any[]) {
        if (typeof item.str !== "string") continue;
        current += item.str;
        if (item.hasEOL) { lines.push(current.trim()); current = ""; }
      }
      if (current.trim()) lines.push(current.trim());
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  // Compacta espacios y descarta líneas vacías.
  return lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
