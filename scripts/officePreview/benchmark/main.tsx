import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { OfficePreview } from "../../../src/renderer/components/ContextSidebar/panels/office/OfficePreview";
import { OfficeSearchPanel } from "../../../src/renderer/components/ContextSidebar/panels/office/OfficeSearchPanel";
import { PreviewFindBar } from "../../../src/renderer/components/ContextSidebar/panels/PreviewFindBar";
import {
  SearchPopover,
  type SearchPopoverHandle,
} from "../../../src/renderer/components/ContextSidebar/panels/SearchPopover";
import { SelectionToolbar } from "../../../src/renderer/components/SessionArea/SelectionToolbar";
import { useOfficeSearchProvider } from "../../../src/renderer/hooks/useOfficeSearchProvider";
import { usePreviewFind } from "../../../src/renderer/hooks/usePreviewFind";
import { useT } from "../../../src/renderer/hooks/useT";
import { UiProvider, useUiStore } from "../../../src/renderer/stores/uiStore";
import { officeSelectionSource } from "../../../src/renderer/utils/officeSelection";
import { setI18nLocale } from "../../../src/shared/i18n";
import type { FsReadOfficeResult } from "../../../src/shared/ipc";
import "../../../src/renderer/styles/tokens.css";
import "../../../src/renderer/styles/global.css";

let sequence = 0;
let sampleStart = 0;
let readMs = 0;
let finished = 0;
let frames: { start: number; duration: number }[] = [];
let longTasks: { start: number; duration: number }[] = [];
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries())
    longTasks.push({ start: entry.startTime, duration: entry.duration });
});
observer.observe({ type: "longtask", buffered: true });
let previous = performance.now();
function tick(now: number) {
  if (sampleStart) frames.push({ start: previous, duration: now - previous });
  previous = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

function App() {
  const t = useT();
  const { dispatch } = useUiStore();
  useEffect(() => dispatch({ type: "setLocalePreference", preference: "zh-CN" }), [dispatch]);
  const [current, setCurrent] = useState<{
    id: number;
    name: string;
    result: FsReadOfficeResult;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const selection = useMemo(() => officeSelectionSource(ref), []);
  const officeRef = useRef<SearchPopoverHandle>(null);
  const [searchProvider, setSearchProvider] = useOfficeSearchProvider();
  const [searchOpen, setSearchOpen] = useState(false);
  const closeSearch = useCallback(() => officeRef.current?.closeSearch(), []);
  const find = usePreviewFind(ref, String(current?.id));
  useEffect(() => {
    Object.assign(window, {
      bench: {
        async open(name: string) {
          frames = [];
          longTasks = [];
          finished = 0;
          sampleStart = performance.now();
          const result = await window.officeBenchmark.read(name);
          readMs = performance.now() - sampleStart;
          setSearchOpen(false);
          setCurrent({ id: ++sequence, name, result });
        },
        async close() {
          setCurrent(null);
          setSearchOpen(false);
          find.close();
          await paint();
          sampleStart = 0;
          frames = [];
          longTasks = [];
        },
        find(text: string) {
          find.openFind();
          find.setQuery(text);
        },
        async search(query: string, scope: "preview" | "file" = "preview") {
          officeRef.current?.openSearch();
          await paint();
          const input = document.querySelector<HTMLInputElement>(
            'input[aria-label="在文件中查找（Enter 下一个）"]',
          );
          if (!input) throw new Error("Office search input is not mounted");
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
          setter?.call(input, query);
          input.dispatchEvent(
            new InputEvent("input", { bubbles: true, inputType: "insertText", data: query }),
          );
          if (scope === "file") {
            await paint();
            const button = [...document.querySelectorAll("button")].find((item) =>
              item.textContent?.includes("搜索整个工作簿"),
            );
            button?.click();
          }
        },
        searchSnapshot() {
          return {
            results: [...document.querySelectorAll("ol li")].map((item) => item.textContent),
            status: [...document.querySelectorAll(".status")].map((item) => item.textContent),
            body: ref.current?.innerText.slice(0, 400),
          };
        },
        async finish() {
          await paint();
          finished = performance.now();
          await new Promise((r) => setTimeout(r, 80));
          const end = finished;
          const tasks = longTasks.filter((task) => task.start >= sampleStart && task.start < end);
          const gaps = frames.filter((frame) => frame.start >= sampleStart && frame.start < end);
          const result = {
            elapsedMs: end - sampleStart,
            readMs,
            longTaskCount: tasks.length,
            maxLongTaskMs: Math.max(0, ...tasks.map((task) => task.duration)),
            blockingMs: tasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
            maxFrameGapMs: Math.max(0, ...gaps.map((frame) => frame.duration)),
          };
          sampleStart = 0;
          return result;
        },
        ready() {
          const frame = document.querySelector<HTMLIFrameElement>("[data-office-preview]");
          if (
            frame &&
            !frame.hasAttribute("data-loading") &&
            frame.contentDocument?.getElementById("office-content")?.firstElementChild
          ) {
            const images = [...frame.contentDocument.querySelectorAll("img")];
            if (images.every((image) => image.complete && image.naturalWidth > 0))
              return "document";
          }
          if (document.querySelector("tbody")) return "sheet";
          const text = ref.current?.innerText ?? "";
          if (text.includes("无法在侧栏预览")) return "error";
          if (text.includes("没有可显示的表格数据")) return "empty";
          return null;
        },
        hasText(text: string) {
          const frame = document.querySelector<HTMLIFrameElement>("[data-office-preview]");
          return (
            frame?.contentDocument?.getElementById("office-content")?.textContent ??
            ref.current?.textContent ??
            ""
          ).includes(text);
        },
        snapshot() {
          const frame = document.querySelector<HTMLIFrameElement>("[data-office-preview]");
          return {
            text: (
              frame?.contentDocument?.getElementById("office-content")?.textContent ??
              ref.current?.textContent ??
              ""
            ).slice(0, 600),
            rows: document.querySelectorAll("tbody tr").length,
            cells: document.querySelectorAll("tbody td").length,
            frameNodes: frame?.contentDocument?.querySelectorAll("*").length ?? 0,
            bodyText: ref.current?.innerText.slice(0, 220),
          };
        },
      },
    });
  }, [find.openFind, find.setQuery, find.close]);
  useEffect(() => {
    const key = (event: KeyboardEvent): void => {
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        officeRef.current?.openSearch();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const isFrame = current?.result.status === "ready" && current.result.format !== "spreadsheet";
  return (
    <div
      id="benchmark-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        width: 520,
        height: 850,
        margin: 16,
        border: "1px solid var(--color-border)",
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      {current && (
        <SearchPopover
          key={current.id}
          ref={officeRef}
          title={t("panels.files.findTitle")}
          onOpenChange={setSearchOpen}
        >
          {(close, focusTick) => (
            <OfficeSearchPanel provider={searchProvider} focusTick={focusTick} onClose={close} />
          )}
        </SearchPopover>
      )}
      {find.open && (
        <PreviewFindBar {...find} onQuery={find.setQuery} onStep={find.step} onClose={find.close} />
      )}
      <div ref={ref} style={{ overflow: "auto", minHeight: 0, padding: 8 }}>
        {current && (
          <OfficePreview
            key={current.id}
            result={current.result}
            onOpenInSystem={() => {}}
            onSearchProvider={setSearchProvider}
            searchOpen={searchOpen}
            onCloseSearch={closeSearch}
          />
        )}
      </div>
      <SelectionToolbar
        key={`${current?.id}:${isFrame ? "frame" : "table"}`}
        containerRef={ref}
        selectionSource={selection}
        quoteDisabled={false}
        quoteDisabledHint=""
        onCopy={(text) => Object.assign(window, { benchmarkCopy: text })}
        onQuote={(text) => Object.assign(window, { benchmarkQuote: `${current?.name}\n${text}` })}
      />
    </div>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Benchmark root missing");
createRoot(root).render(
  <UiProvider>
    <App />
  </UiProvider>,
);
setTimeout(() => setI18nLocale("zh-CN"), 50);
