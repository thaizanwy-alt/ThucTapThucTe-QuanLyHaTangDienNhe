import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { dataSource } from './data-source';
import { EvidenceStorage } from '../evidence/evidence.storage';

// Deliberately report-only: an unreferenced file may belong to an in-flight
// transaction or an upload whose COMMIT acknowledgement was lost. Never delete.
export async function reconcileEvidence(db = dataSource, storage = new EvidenceStorage()) {
  const root = await storage.root();
  const rows: { storage_key: string }[] = await db.query('SELECT storage_key FROM evidence_attachments');
  const referenced = new Set(rows.map(row => row.storage_key));
  const files = await readdir(join(root, 'files'));
  const safeNames = files.filter(name => /^[a-f0-9-]{36}$/.test(name));
  const unreferencedOrInFlight = safeNames.filter(name => !referenced.has(name));
  const missing = rows.filter(row => !files.includes(row.storage_key)).map(row => row.storage_key);
  const temporary = await readdir(join(root, 'tmp'));
  const invalidEntryCount = files.length - safeNames.length + (await Promise.all(safeNames.map(async name => !(await lstat(join(root, 'files', name))).isFile()))).filter(Boolean).length;
  return { reportOnly: true, referenced: rows.length, missing, unreferencedOrInFlight,
    temporaryOrInFlightCount: temporary.length, invalidEntryCount, deleted: 0 };
}
if (require.main === module) {
  void (async () => {
    try { await dataSource.initialize(); console.log(JSON.stringify(await reconcileEvidence(), null, 2)); }
    catch { console.error('Evidence reconciliation failed; check database/storage configuration (no files deleted).'); process.exitCode = 1; }
    finally { if (dataSource.isInitialized) await dataSource.destroy(); }
  })();
}
