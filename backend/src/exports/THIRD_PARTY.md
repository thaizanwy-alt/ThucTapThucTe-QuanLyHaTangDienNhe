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

## Handover ZIP dependencies (verified 2026-10-17)

- `yazl@3.3.1` (runtime): MIT, upstream manifest lists `buffer-crc32 ^1.0.0`.
  The upstream README documents writing through `outputStream` and adding files
  from paths. Source: https://github.com/thejoshwolfe/yazl/tree/v3.3.1 and
  https://github.com/thejoshwolfe/yazl/blob/v3.3.1/package.json. Upstream
  security page showed no published advisories at review time:
  https://github.com/thejoshwolfe/yazl/security.
- `yauzl@3.4.0` (dev-only ZIP reader): MIT; upstream manifest lists `pend ~1.2.0`.
  Source: https://github.com/thejoshwolfe/yauzl/tree/v3.4.0 and
  https://github.com/thejoshwolfe/yauzl/blob/v3.4.0/package.json. The GitHub
  advisory GHSA-gmq8-994r-jv83/CVE-2026-31988 affects yauzl 3.2.0 and identifies
  3.2.1 as patched; the lockfile selects 3.4.0:
  https://github.com/advisories/GHSA-gmq8-994r-jv83.

`npm explain yazl` and `npm explain yauzl` show only the intended direct
runtime/dev entries. `npm explain buffers` and `npm explain exceljs` report no
matching dependencies. `npm install` reported zero vulnerabilities when these
packages were added; a later `npm audit` could not reach `registry.npmjs.org`
in the restricted network, so this is not a fresh complete registry audit.
The ZIP writer pipes generated archive bytes through an in-flight size limiter
to a temporary file; it does not retain the complete ZIP in memory. The XLSX
writer remains separately isolated in its child process.
