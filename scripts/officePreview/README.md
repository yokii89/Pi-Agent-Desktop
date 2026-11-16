# Office preview fixtures and benchmark

Use Node.js 24 and the repository's pinned pnpm version. No new test framework or fixture-generation dependency is required.

```sh
pnpm fixtures:office
pnpm bench:office current
```

`fixtures:office` creates **22 synthetic files** in `temp/office-preview/corpus/` plus a readable index and `manifest.json` containing sizes, expected contents and SHA-256 values. Regeneration is byte-identical; the binary files stay out of Git. Pass an output directory to generate elsewhere. The encrypted and legacy samples are header/dispatch fixtures, not full encrypted or historical-format documents.

Coverage includes 120-page DOCX, 24,000-run unpaginated DOCX, 36-page image DOCX, 120-slide PPTX, 60-slide image PPTX, 1.2-million-cell XLSX, 40-sheet XLSX, 250-column XLSX, D50000-origin sparse data, cached/uncached formulas, long cell contents, XLS/XLSB/XLSM, headers/footers/notes/numbering, corruption and budget limits.

`bench:office` builds the real main-process read path and the real React preview components, runs them in an isolated Electron profile using `file://` and the application CSP, measures every file three times, and closes the instance afterward. The benchmark window appears without taking focus; background throttling is disabled so hidden-window timer limits do not masquerade as preview delays. Port 9388 must be free. User settings and sessions are not read or written.

Results go to `temp/office-benchmark/<label>.json`; preview assertions go to `regression.json`, and cross-page search, jump, cancellation and citation checks go to `search-regression.json`. The harness measures main-process read + IPC time, time to displayed content and two animation frames, long tasks, frame gaps, post-GC heap/DOM counters and renderer working set. It separately exercises page navigation, row paging, sheet selection, sparse coordinates, notes, cached pages, search cleanup and switching away during parsing. Production code contains no benchmark hooks.

Optional environment variables:

- `OFFICE_BENCH_RUNS=1` for a quick run (1–10 accepted).
- `OFFICE_BENCH_CASES=word-dense.docx,grid-large.xlsx` to restrict measured files. Interactive regressions still run.

Compare medians on the same machine with the same generated files. Record cold first-load time separately; later runs reuse module/OS caches. A zero long-task result means no task reached the browser's 50 ms reporting threshold, not that rendering is free. Working set and JS heap are different metrics; allocator retention does not alone prove a leak. DOM document counts after search + close are the relevant frame-retention check.

## Patched parser contracts

The pinned versions have opt-in additions maintained through `pnpm-workspace.yaml` and `patches/`:

- `docx-preview@0.4.1`: `createPageRenderer()` parses document children in yielding batches, then exposes page count, styles and `get(index)`. Unpaginated content is split at top-level paragraph/table boundaries. Numbering counter snapshots preserve cross-page list numbering; footnote/header state is reset per render. Existing `renderAsync()` remains available.
- `@jvmr/pptx-to-html@1.1.2`: `openPresentation()` retains one ZIP index and parses the requested slide in saved presentation order, including layout/master dependencies. Existing `pptxToHtml()` remains available.

The adapter serializes page requests, rejects canceled work and keeps only three rendered pages. `getText(index)` reads text without page DOM or image decoding; DOCX also returns heading paths and marks rendered headings for source-aware quotes. Workbook full-file search has its own disposable Worker; the visible preview still owns its independent Worker.

Search is literal and case-insensitive. DOCX/PPTX searches text and tables, excluding image text and PPT chart labels. Excel searches the current preview window by default; a separate action scans workbook cells, up to 200 results, 100,000 rows per sheet, 2,000,000 cells and 30 seconds. DOCX/PPTX text indexing has an 8 Mi-character budget. Limits and cancellation retain partial results with a visible notice; no search is silently treated as complete. The heading/cross-run search fixture is `word-search.docx`.

Do not remove the patches or upgrade either package without rerunning the fixture benchmark and compatibility checks. A large single XML parse or one giant table can still create a long task; the adapter does not claim fully preemptible parsing.
