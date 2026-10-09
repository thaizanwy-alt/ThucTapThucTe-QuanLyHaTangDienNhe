import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChecklistTemplate, ChecklistTemplateItem } from './inspection.entities';
import { templateFixtures } from './template-fixtures';

// One transaction, preflight every existing revision before creating any missing one.
// A published revision is never overwritten, whether or not it is already in use.
export async function seedTemplates(db: DataSource): Promise<{ templates: number; items: number }> {
  return db.transaction(async m => {
    await m.query('LOCK TABLE checklist_templates, checklist_template_items IN SHARE ROW EXCLUSIVE MODE');
    const missing: typeof templateFixtures = [];
    for (const fixture of templateFixtures) {
      const existing = await m.findOneBy(ChecklistTemplate, { code: fixture.code, revision: fixture.revision });
      if (!existing) { missing.push(fixture); continue; }
      const items = await m.find(ChecklistTemplateItem, { where: { templateId: existing.id }, order: { sortOrder: 'ASC', code: 'ASC' } });
      if (existing.name !== fixture.name || existing.category !== fixture.category || !existing.isActive ||
        items.length !== fixture.items.length || items.some((item, i) =>
          (['code', 'title', 'instruction', 'sortOrder'] as const).some(key => item[key] !== fixture.items[i][key]))) {
        throw new ConflictException(`Template ${fixture.code} revision ${fixture.revision} differs; refusing to overwrite`);
      }
    }
    let count = 0;
    for (const fixture of missing) {
      const template = await m.save(ChecklistTemplate, m.create(ChecklistTemplate, {
        code: fixture.code, name: fixture.name, category: fixture.category, revision: fixture.revision, isActive: true,
      }));
      await m.save(ChecklistTemplateItem, fixture.items.map(item => m.create(ChecklistTemplateItem, { ...item, templateId: template.id })));
      count += fixture.items.length;
    }
    return { templates: missing.length, items: count };
  });
}
