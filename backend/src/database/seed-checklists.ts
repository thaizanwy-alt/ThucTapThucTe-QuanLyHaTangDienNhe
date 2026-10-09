import { dataSource } from './data-source';
import { seedTemplates } from '../inspections/seed-templates';

async function main() {
  try {
    await dataSource.initialize();
    const count = await seedTemplates(dataSource);
    console.log(`Checklist templates created: ${count.templates}; items: ${count.items}`);
  } catch {
    // Do not log connection options or raw errors which may contain credentials.
    console.error('Checklist seed failed. Check migrations or conflicting template revisions; no revision was overwritten.');
    process.exitCode = 1;
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}
void main();
