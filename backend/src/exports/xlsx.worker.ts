import { Writable } from 'node:stream';
import writeXlsxFile from 'write-excel-file/node';
import { Sheet, safeCell } from './exports.render';

// Receives only prevalidated, whitelisted workbook cells through IPC. No DB,
// credentials or storage configuration is available in this process.
process.once('message', async (sheets: Sheet[]) => {
  try {
    const pages = sheets.map(sheet => ({
      sheet: sheet.name,
      columns: sheet.columns.map(() => ({ width: 24 })),
      data: [sheet.columns.map(value => ({ value: safeCell(value), fontWeight: 'bold' as const })),
        ...sheet.rows.map(row => row.map(value => value === null ? null : safeCell(value)))],
    }));
    const output = new Writable({ write(chunk: Buffer, _encoding, callback) {
      if (process.stdout.write(chunk)) callback();
      else process.stdout.once('drain', callback);
    } });
    await writeXlsxFile(pages).toStream(output);
    if (process.send) await new Promise<void>(resolve => process.send!({ peakRssBytes: process.resourceUsage().maxRSS * 1024 }, () => resolve()));
    process.stdout.end();
    process.exitCode = 0;
  } catch {
    process.exitCode = 1;
  }
});
