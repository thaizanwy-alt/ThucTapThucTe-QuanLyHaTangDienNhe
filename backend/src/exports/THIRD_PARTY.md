# Export dependencies and evidence

Verified 2026-10-16; these notes do not modify package license metadata.

- PDFKit 0.20.2: MIT. Upstream: https://github.com/foliojs/pdfkit/blob/v0.20.2/LICENSE
- write-excel-file 4.1.1: MIT; published npm manifest declares Node >=18 and `fflate ^0.8.2`.
  Upstream license: https://github.com/catamphetamine/write-excel-file/blob/master/LICENSE
- read-excel-file 9.3.10: MIT, test-only reader; dependencies in the published manifest:
  `fflate ^0.8.3`, `saxen ^11.1.0`, `worker-f ^0.1.12`, `unzipper-esm ^0.13.3`.
  Upstream license: https://github.com/catamphetamine/read-excel-file/blob/master/LICENSE
- Installed `fflate` is 0.8.3 (MIT), the patched version for
  https://github.com/advisories/GHSA-px8p-9vwx-vf98.
- Noto Sans: SIL Open Font License 1.1; bundled font and full notice in `fonts/`.
  Source: https://github.com/google/fonts/tree/main/ofl/notosans
  Font SHA-256: bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d.

The old ExcelJS → unzipper → binary → buffers chain is absent after npm uninstall;
`npm explain exceljs` and `npm explain buffers` report no matching dependency.
`npm audit --omit=dev` reported zero advisories on 2026-10-16. This is a
point-in-time check, not a guarantee against future advisories.
