import { createRoot } from "react-dom/client";
import { PdfPreview } from "../../src/renderer/components/ContextSidebar/panels/PdfPreview";
import styles from "../../src/renderer/components/ContextSidebar/panels/PdfPreview.module.css";
import { UiProvider } from "../../src/renderer/stores/uiStore";
import { t } from "../../src/shared/i18n";
import type { FsReadPdfResult } from "../../src/shared/ipc";
import "../../src/renderer/styles/tokens.css";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PDF interaction: ${message}`);
}

async function waitFor<T>(read: () => T | null, label: string): Promise<T> {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    const value = read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`PDF interaction timed out: ${label}`);
}

/** Exercise the actual preview and selection layer in the existing isolated Electron harness. */
export async function runPdfInteractionRegression(fixture: { text: string; data: number[] }) {
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;top:0;left:0;width:300px;height:480px;background:var(--color-bg);font-family:var(--font-family-ui)";
  document.body.append(host);
  const root = createRoot(host);
  const result: FsReadPdfResult = {
    kind: "pdf",
    data: new Uint8Array(fixture.data),
    byteLength: fixture.data.length,
  };
  let searchClosed = 0;
  const closeSearch = () => searchClosed++;
  const mount = (value: FsReadPdfResult) =>
    root.render(
      <UiProvider>
        <PdfPreview result={value} onCloseSearch={closeSearch} />
      </UiProvider>,
    );
  const cleanup = () => {
    root.unmount();
    host.remove();
  };
  Object.assign(window, { cleanupPdfInteractionRegression: cleanup });
  const dprDescriptor = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  const restoreDpr = () => {
    if (dprDescriptor) Object.defineProperty(window, "devicePixelRatio", dprDescriptor);
    else Reflect.deleteProperty(window, "devicePixelRatio");
    window.dispatchEvent(new Event("resize"));
  };
  const sample = document.createElement("canvas");
  sample.width = 160;
  sample.height = 80;
  const sampleContext = sample.getContext("2d", { willReadFrequently: true });
  assert(sampleContext, "no sampling context");

  const button = (key: Parameters<typeof t>[0]) => {
    const element = [...host.querySelectorAll("button")].find((item) => item.title === t(key));
    assert(element, `missing button ${key}`);
    return element;
  };
  const read = () => {
    const canvas = host.querySelector("canvas");
    const layer = host.querySelector<HTMLDivElement>(`.${styles.textLayer}`);
    const wrap = host.querySelector<HTMLElement>(`.${styles.canvasWrap}`);
    if (!canvas || !layer || !wrap || canvas.width <= 0 || !canvas.style.width) return null;
    if (layer.textContent !== fixture.text) return null;
    sampleContext.clearRect(0, 0, sample.width, sample.height);
    sampleContext.drawImage(canvas, 0, 0, sample.width, sample.height);
    const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
    let ink = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 200 && pixels[index] < 200) ink++;
    }
    if (ink < 20) return null;
    return {
      canvas,
      layer,
      wrap,
      width: Number.parseFloat(canvas.style.width),
      height: Number.parseFloat(canvas.style.height),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
  };
  const ready = (label: string, matches = (_value: NonNullable<ReturnType<typeof read>>) => true) =>
    waitFor(() => {
      const value = read();
      return value && matches(value) ? value : null;
    }, label);
  const checkLayer = (state: NonNullable<ReturnType<typeof read>>) => {
    const canvasRect = state.canvas.getBoundingClientRect();
    const layerRect = state.layer.getBoundingClientRect();
    for (const dimension of ["left", "top", "width", "height"] as const) {
      assert(
        Math.abs(canvasRect[dimension] - layerRect[dimension]) < 0.1,
        `${dimension} misaligned: canvas=${canvasRect[dimension]}, layer=${layerRect[dimension]}, zoom=${button("panels.files.pdfActualSize").textContent}`,
      );
    }
    const range = document.createRange();
    range.selectNodeContents(state.layer);
    const selection = window.getSelection();
    assert(selection, "no selection");
    selection.removeAllRanges();
    selection.addRange(range);
    assert(selection.toString() === fixture.text, "selection text changed after zoom");
    selection.removeAllRanges();
  };
  try {
    mount(result);
    let state = await ready("initial fitted page");
    const fittedWidth = state.width;
    assert(fittedWidth < 300, "page did not fit the sidebar content width");
    checkLayer(state);

    host.style.width = "1100px";
    state = await ready("wide fitted page", (value) => value.width > 1000);
    assert(state.width > 480 * 1.35, "fit width still uses the old scale ceiling");
    host.style.width = "300px";
    await ready("narrow fitted page", (value) => Math.abs(value.width - fittedWidth) < 1);

    button("panels.files.pdfActualSize").click();
    state = await ready("100% page", (value) => Math.abs(value.width - 640) < 0.1);
    checkLayer(state);
    state.wrap.scrollLeft = 0;
    assert(
      state.canvas.getBoundingClientRect().left >= state.wrap.getBoundingClientRect().left,
      "the left edge of an enlarged page is unreachable",
    );
    state.wrap.scrollLeft = state.wrap.scrollWidth;
    assert(state.wrap.scrollLeft > 0, "enlarged page cannot scroll horizontally");
    const rightEdge = state.canvas.getBoundingClientRect().right;
    assert(rightEdge <= state.wrap.getBoundingClientRect().right + 1, "right edge is unreachable");
    host.style.width = "500px";
    await new Promise((resolve) => setTimeout(resolve, 60));
    state = await ready("manual zoom after resizing");
    assert(Math.abs(state.width - 640) < 0.1, "resizing changed the manual zoom");

    button("panels.files.pdfZoomIn").click();
    state = await ready("125% page", (value) => Math.abs(value.width - 800) < 0.1);
    checkLayer(state);
    for (const ratio of [1.5, 2]) {
      Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: ratio });
      window.dispatchEvent(new Event("resize"));
      state = await ready(
        `DPR ${ratio}`,
        (value) => Math.abs(value.canvasWidth - value.width * ratio) <= 1.01,
      );
      assert(Math.abs(state.width - 800) < 0.1, "DPR changed the CSS page size");
      checkLayer(state);
    }
    const hidpiWidth = state.canvasWidth;
    // Dispatch back-to-back clicks before React commits to cover stale zoom state and cancellation.
    for (let index = 0; index < 6; index++) button("panels.files.pdfZoomIn").click();
    state = await ready("rapid zoom to 400%", (value) => Math.abs(value.width - 2560) < 0.1);
    assert(state.canvasWidth > hidpiWidth, "zoom only stretched the old bitmap");
    assert(
      state.canvasWidth * state.canvasHeight <= 16_000_000,
      "canvas exceeded its pixel budget",
    );
    assert(button("panels.files.pdfZoomIn").disabled, "maximum zoom is not bounded");
    checkLayer(state);
    for (let index = 0; index < 12; index++) button("panels.files.pdfZoomOut").click();
    state = await ready("rapid zoom to 25%", (value) => Math.abs(value.width - 160) < 0.1);
    assert(button("panels.files.pdfZoomOut").disabled, "minimum zoom is not bounded");

    button("panels.files.pdfActualSize").click();
    await ready("reset from minimum", (value) => Math.abs(value.width - 640) < 0.1);
    button("panels.files.forwardNext").click();
    state = await ready("rotated second page", (value) => Math.abs(value.width - 320) < 0.1);
    assert(Math.abs(state.height - 640) < 0.1, "rotated page dimensions are incorrect");
    checkLayer(state);
    button("panels.files.backPrevious").click();
    await ready("first page after navigation", (value) => Math.abs(value.width - 640) < 0.1);
    button("panels.files.pdfFitWidth").click();
    state = await ready("return to fit width", (value) => value.width < 500);
    assert(
      button("panels.files.pdfFitWidth").getAttribute("aria-pressed") === "true",
      "fit state lost",
    );

    button("panels.files.pdfActualSize").click();
    await ready("manual zoom before reload", (value) => Math.abs(value.width - 640) < 0.1);
    mount({ ...result, data: result.data.slice() });
    state = await ready("reload resets to fitted page", (value) => value.width < 500);
    assert(result.data.byteLength === result.byteLength, "preview detached its source bytes");
    assert(searchClosed === 0, "zoom or navigation produced a rendering error");
    restoreDpr();
    state = await ready(
      "restored display pixel ratio",
      (value) => Math.abs(value.canvasWidth - value.width * window.devicePixelRatio) <= 1.01,
    );
    checkLayer(state);
    return {
      fittedWidth,
      finalWidth: state.width,
      finalCanvasWidth: state.canvasWidth,
      checks: [
        "fit-width",
        "manual-zoom",
        "hidpi-change",
        "rapid-zoom",
        "selection",
        "scroll",
        "page-navigation",
        "reload",
      ],
    };
  } catch (error) {
    restoreDpr();
    cleanup();
    throw error;
  }
}
