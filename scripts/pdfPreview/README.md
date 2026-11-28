# PDF preview regression

Run `pnpm check:pdf-preview` with the repository's Node.js and pnpm versions. No new dependencies or downloaded fixtures are needed.

The harness uses the application's PDF loader, resource options, Vite plugins and CSP in an isolated, hidden Electron instance. It checks the development server, production `file://` paths containing spaces and Chinese characters, and the same build inside an ASAR archive. User settings and sessions are not accessed.

Nine deterministic PDFs cover simplified/traditional Chinese, Japanese, Korean, Symbol, ZapfDingbats, unembedded Latin, embedded TrueType and JPEG2000. Assertions cover extracted text, the selection text layer, nonblank canvas output, decoded image color, actual CMap/font/decoder requests, and absence of PDF.js warnings or CSP violations. Standard fonts are forced to load for this check, so installed Latin fonts cannot hide a missing resource. Missing development resources must return 404, not application HTML.

The same harness mounts the actual React PDF preview and exercises fit width, 25%–400% zoom, 100% reset, fractional/2× DPR changes, rapid zoom cancellation, selection-layer alignment, horizontal scrolling, rotated-page navigation and reload. The Latin fixture includes a rotated second page. Viewport unit tests separately cover the canvas pixel and dimension budgets.

Binary fixtures, isolated profiles, build output, JSON reports, fixture screenshots and interactive preview screenshots are generated under the ignored `temp/pdf-preview/` directory. The embedded font comes from the installed PDF.js package; its licenses are retained with the built resources. The tiny JPEG2000 image is a generated solid-color fixture.

The check does not claim support for malformed PDFs, missing custom fonts, incorrect Unicode maps or every character in nonembedded fonts. CJK fallback rendering still uses fonts available in the OS. The test reads the library's extracted text; it performs no OCR.
