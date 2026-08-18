import workerSource from "pdfjs-worker-source";

/**
 * Community-directory installs only receive main.js, manifest.json and
 * styles.css, so the pdf.js worker cannot live next to the plugin as a
 * separate file. The worker source is bundled into main.js and started from
 * an object URL instead; pdf.js receives the ready-made worker as
 * `GlobalWorkerOptions.workerPort`.
 */
let workerUrl: string | null = null;
let worker: Worker | null = null;

export function pdfWorkerPort(): Worker {
  if (!worker) {
    const blob = new Blob([workerSource], { type: "text/javascript" });
    workerUrl = URL.createObjectURL(blob);
    worker = new Worker(workerUrl, { type: "module", name: "paper-pdfjs" });
  }
  return worker;
}

export function releasePdfWorker(): void {
  worker?.terminate();
  worker = null;
  if (workerUrl) {
    URL.revokeObjectURL(workerUrl);
    workerUrl = null;
  }
}
