# Export dependencies and evidence

Verified 2026-10-16; these notes do not modify package license metadata.

- PDFKit 0.20.2: MIT. Upstream: https://github.com/foliojs/pdfkit/blob/v0.20.2/LICENSE
- ExcelJS 4.4.0: MIT. Upstream: https://github.com/exceljs/exceljs/blob/v4.4.0/LICENSE
- Noto Sans: SIL Open Font License 1.1; bundled font and full notice in `fonts/`.
  Source: https://github.com/google/fonts/tree/main/ofl/notosans
  Font SHA-256: bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d.

## buffers 0.1.1: unresolved upstream license

Dependency chain: ExcelJS → unzipper → binary → buffers.
The installed published package has no license field, LICENSE file or license
notice in README/index.js. Its package.json identifies James Halliday and
http://github.com/substack/node-buffers.git as upstream.

On 2026-10-16, both the official upstream repository and this historical commit
returned HTTP 404:
- https://github.com/substack/node-buffers
- https://github.com/substack/node-buffers/commit/1b745ee35d33eb166e15ef1866073a07c6d7de87

A third-party mirror declares MIT/X11, but that is insufficient to verify the
published package's license from official upstream. License remains unconfirmed;
no MIT assignment or manual lockfile change was made. Resolve before distribution.
