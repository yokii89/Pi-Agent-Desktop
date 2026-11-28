import { loadPdfJs } from "../../src/renderer/utils/pdfLoader";
import { getPdfResourceOptions } from "../../src/renderer/utils/pdfResources";
import { runPdfInteractionRegression } from "./interaction";

type Fixture = { name: string; text: string; data: number[]; color?: number[] };

const violations: string[] = [];
window.addEventListener("securitypolicyviolation", (event) =>
  violations.push(`${event.violatedDirective}: ${event.blockedURI}`),
);
Object.assign(window, { pdfCspViolations: violations });

async function readBytes(url: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url);
    xhr.responseType = "arraybuffer";
    xhr.onload = () => resolve(new Uint8Array(xhr.response));
    xhr.onerror = () => reject(new Error(`Resource failed: ${url}`));
    xhr.send();
  });
}

async function run(fixtures: Fixture[]) {
  const pdfjs = await loadPdfJs();
  const options = getPdfResourceOptions();
  const results: { name: string; text: string; ink: number }[] = [];
  for (const fixture of fixtures) {
    // Force standard-font loading as well as CMaps, independent of installed Latin fonts.
    const task = pdfjs.getDocument({
      ...options,
      data: new Uint8Array(fixture.data),
      useSystemFonts: false,
    });
    try {
      const document = await task.promise;
      const page = await document.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.flatMap((item) => ("str" in item ? [item.str] : [])).join("");
      if (text !== fixture.text)
        throw new Error(`${fixture.name}: expected ${fixture.text}, got ${text}`);
      const canvas = window.document.createElement("canvas");
      const viewport = page.getViewport({ scale: 1 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No canvas context");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const layer = window.document.createElement("div");
      layer.style.visibility = "hidden";
      layer.style.position = "absolute";
      layer.style.setProperty("--total-scale-factor", "1");
      window.document.body.append(layer);
      const textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport,
      });
      try {
        await textLayer.render();
        if (layer.textContent !== fixture.text)
          throw new Error(`${fixture.name}: text layer mismatch`);
      } finally {
        textLayer.cancel();
        layer.remove();
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 200) ink++;
      }
      if (ink < 100) throw new Error(`${fixture.name}: blank canvas (${ink} pixels)`);
      if (fixture.color) {
        const pixel = context.getImageData(70, 100, 1, 1).data;
        if (fixture.color.some((value, index) => Math.abs(value - pixel[index]) > 3)) {
          throw new Error(`${fixture.name}: decoder produced the wrong color: ${pixel}`);
        }
      }
      const label = window.document.createElement("p");
      label.textContent = fixture.name;
      window.document.body.append(label, canvas);
      results.push({ name: fixture.name, text, ink });
    } finally {
      await task.destroy();
    }
  }
  // Compile the real decoder under the application CSP; a missing WASM allowance fails here.
  const wasm = await readBytes(`${options.wasmUrl}openjpeg.wasm`);
  await WebAssembly.compile(wasm as Uint8Array<ArrayBuffer>);
  const icc = await readBytes(`${options.iccUrl}CGATS001Compat-v2-micro.icc`);
  if (icc.length < 100) throw new Error("Missing ICC resource");
  const font = new FontFace(
    "PdfRegression",
    (await readBytes(
      `${options.standardFontDataUrl}LiberationSans-Regular.ttf`,
    )) as Uint8Array<ArrayBuffer>,
  );
  await font.load();
  const interactionFixture = fixtures.find((fixture) => fixture.name === "latin");
  if (!interactionFixture) throw new Error("Missing interactive PDF fixture");
  const interaction = await runPdfInteractionRegression(interactionFixture);
  return { results, options, wasmBytes: wasm.length, iccBytes: icc.length, interaction };
}

Object.assign(window, { runPdfRegression: run });
