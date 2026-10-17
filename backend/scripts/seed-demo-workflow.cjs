// API-only, resumable demo workflow. Never updates a fixture that differs from a known checkpoint.
const { createHash } = require('node:crypto');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function demoPdf() {
  const parts = ['%PDF-1.4\n'];
  const offsets = [0];
  const object = (id, body) => { offsets[id] = Buffer.byteLength(parts.join('')); parts.push(`${id} 0 obj\n${body}\nendobj\n`); };
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>');
  const text = 'BT /F1 14 Tf 72 760 Td (Fictional ELV demo evidence) Tj ET\n';
  object(4, `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}endstream`);
  object(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const start = Buffer.byteLength(parts.join(''));
  parts.push('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) parts.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  parts.push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  return Buffer.from(parts.join(''));
}
const PDF = demoPdf();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sameId = (a, b) => (a ?? null)?.toLowerCase() === (b ?? null)?.toLowerCase();
const sameIds = (a, b) => JSON.stringify((a || []).map(x => x.toLowerCase()).sort()) === JSON.stringify((b || []).map(x => x.toLowerCase()).sort());
const fail = (kind, code) => { throw new Error(`${kind} ${code} conflicts with demo fixture; no existing record was changed.`); };

const INSPECTIONS = [
  { code: 'DEMO-INSP-LAN-PASS', title: 'LAN — phiếu đạt để nghiệm thu', category: 'LAN', systemCode: 'LAN-BUILDING', areaCode: 'T01-SANH', outcome: 'PASS' },
  { code: 'DEMO-INSP-WIFI-NOTCHECK', title: 'WiFi — chưa kiểm tra', category: 'WIFI', systemCode: 'WIFI-BUILDING', outcome: 'NOT_CHECKED' },
  { code: 'DEMO-INSP-CAM-OPEN', title: 'Camera — lỗi đang mở', category: 'CAMERA', systemCode: 'CAMERA-BUILDING', deviceCode: 'CAM-DIRECT', outcome: 'OPEN' },
  { code: 'DEMO-INSP-CAM-STARTED', title: 'Camera — đang khắc phục', category: 'CAMERA', systemCode: 'CAMERA-BUILDING', deviceCode: 'CAM-PANEL', outcome: 'IN_PROGRESS' },
  { code: 'DEMO-INSP-CAM-RESOLVED', title: 'Camera — chờ kiểm tra lại', category: 'CAMERA', systemCode: 'CAMERA-BUILDING', deviceCode: 'CAM-OUTLET', outcome: 'RESOLVED' },
  { code: 'DEMO-INSP-CAM-CLOSED', title: 'Camera — lỗi đã đóng', category: 'CAMERA', systemCode: 'CAMERA-BUILDING', areaCode: 'T01-SANH', outcome: 'CLOSED' },
];
const ACCEPTANCES = [
  { code: 'DEMO-AC-BLOCKED', title: 'Hồ sơ camera — còn lỗi', systemCode: 'CAMERA-BUILDING', inspectionCode: 'DEMO-INSP-CAM-OPEN', evidenceName: null, status: 'DRAFT' },
  { code: 'DEMO-AC-READY', title: 'Hồ sơ LAN — sẵn sàng xác nhận', systemCode: 'LAN-BUILDING', inspectionCode: 'DEMO-INSP-LAN-PASS', evidenceName: 'demo-current.pdf', status: 'DRAFT' },
  { code: 'DEMO-AC-CONFIRMED-V1', title: 'Nghiệm thu LAN — bản lịch sử', systemCode: 'LAN-BUILDING', inspectionCode: 'DEMO-INSP-LAN-PASS', evidenceName: 'demo-archived.png', status: 'CONFIRMED' },
  { code: 'DEMO-AC-CONFIRMED-V2', title: 'Nghiệm thu LAN — thay thế lần một', systemCode: 'LAN-BUILDING', inspectionCode: 'DEMO-INSP-LAN-PASS', evidenceName: 'demo-current.pdf', status: 'CONFIRMED', predecessor: 'DEMO-AC-CONFIRMED-V1' },
  { code: 'DEMO-AC-CONFIRMED-V3', title: 'Nghiệm thu LAN — thay thế lần hai', systemCode: 'LAN-BUILDING', inspectionCode: 'DEMO-INSP-LAN-PASS', evidenceName: 'demo-current.pdf', status: 'CONFIRMED', predecessor: 'DEMO-AC-CONFIRMED-V2' },
];
const RESULT_NOTE = 'Kết quả giả định theo phiếu demo.';
const ISSUE_DESCRIPTION = 'Ảnh hoặc nhãn camera demo chưa đạt; cần khắc phục.';
const RESOLUTION_NOTE = 'Đã sửa theo mô phỏng và đề nghị kiểm tra lại.';
const RECHECK_NOTE = 'Đã kiểm tra lại theo kịch bản demo.';
const CAPTION = 'Minh chứng giả định cho công trình demo';
const matchesEvidence = (row, bytes, mime, targetKey, targetId, uploaderId) =>
  row.sha256 === sha(bytes) && row.sizeBytes === bytes.length && row.mimeType === mime &&
  row.caption === CAPTION && sameId(row[targetKey], targetId) && sameId(row.uploadedBy?.id, uploaderId);

function assertInspectionCheckpoint(sheet, spec, template, systemId, areaId, deviceId, technicianId) {
  if (sheet.code !== spec.code || sheet.title !== spec.title || !sameId(sheet.systemId, systemId) ||
    !sameId(sheet.areaId, areaId) || !sameId(sheet.deviceId, deviceId) ||
    !sameId(sheet.templateId, template.id) || sheet.templateRevision !== template.revision ||
    sheet.items?.length !== template.items.length) fail('Inspection', spec.code);
  const firstCode = template.items[0].code;
  for (const source of template.items) {
    const item = sheet.items.find(x => x.code === source.code);
    if (!item || item.title !== source.title || item.instruction !== source.instruction || item.sortOrder !== source.sortOrder) fail('Inspection item', spec.code);
    const isFirst = source.code === firstCode;
    const allowed = spec.outcome === 'NOT_CHECKED' ? ['NOT_CHECKED'] :
      spec.outcome === 'PASS' || (spec.outcome === 'CLOSED' && !isFirst) ? ['NOT_CHECKED', 'PASS'] :
      isFirst ? ['NOT_CHECKED', 'FAIL', ...(spec.outcome === 'CLOSED' ? ['PASS'] : [])] : ['NOT_CHECKED'];
    if (!allowed.includes(item.result) ||
      item.version !== (spec.outcome === 'CLOSED' && isFirst && item.result === 'PASS' ? 3 : item.result === 'NOT_CHECKED' ? 1 : 2) ||
      (item.result === 'NOT_CHECKED' && (item.note != null || item.issues.length)) ||
      (item.result === 'PASS' && item.note !== (spec.outcome === 'CLOSED' && isFirst ? RECHECK_NOTE : RESULT_NOTE)) ||
      (item.result === 'FAIL' && item.note !== RESULT_NOTE)) fail('Inspection item', `${spec.code}/${source.code}`);
    if (!isFirst || ['PASS', 'NOT_CHECKED'].includes(spec.outcome)) {
      if (item.issues.length) fail('Inspection issue', `${spec.code}/${source.code}`);
      continue;
    }
    if (item.issues.length > 1) fail('Inspection issue', spec.code);
    const issue = item.issues[0];
    if (item.result === 'NOT_CHECKED' && issue) fail('Inspection issue', spec.code);
    if (item.result === 'FAIL' && !issue) fail('Inspection issue', spec.code);
    if (item.result === 'PASS' && issue?.status !== 'CLOSED') fail('Inspection issue', spec.code);
    if (issue) {
      const stages = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
      if (issue.description !== ISSUE_DESCRIPTION || !sameId(issue.assigneeId, technicianId) ||
        !stages.slice(0, stages.indexOf(spec.outcome) + 1).includes(issue.status) ||
        issue.version !== stages.indexOf(issue.status) + 1 || issue.returnReason != null ||
        (['RESOLVED', 'CLOSED'].includes(issue.status) ? issue.resolutionNote !== RESOLUTION_NOTE : issue.resolutionNote != null) ||
        (issue.status === 'CLOSED' ? !issue.reviewedAt : issue.reviewedAt != null)) fail('Inspection issue', spec.code);
    }
  }
}

function assertAcceptanceCheckpoint(row, spec, systemId, inspectionId, evidenceId, predecessorId) {
  if (row.code !== spec.code || row.title !== spec.title || !sameId(row.systemId, systemId) ||
    !sameId(row.replacesId, predecessorId) || row.note != null ||
    row.replacementReason !== (spec.predecessor ? 'Thay thế hồ sơ demo để minh họa lịch sử phiên bản.' : null) ||
    !sameIds(row.inspectionIds, [inspectionId]) || !sameIds(row.evidenceIds, evidenceId ? [evidenceId] : []) ||
    !['DRAFT', ...(spec.status === 'CONFIRMED' ? ['CONFIRMED'] : [])].includes(row.status) ||
    row.version !== (row.status === 'CONFIRMED' ? 2 : 1)) fail('Acceptance', spec.code);
  if (row.status === 'CONFIRMED' && (row.snapshot?.schemaVersion !== 1 || !row.snapshot?.content || !row.confirmedAt ||
    row.snapshot.content.acceptance?.code !== spec.code || !sameId(row.snapshot.content.system?.id, systemId) ||
    row.snapshot.content.inspections?.length !== 1 || !sameId(row.snapshot.content.inspections[0]?.id, inspectionId))) fail('Acceptance snapshot', spec.code);
}

function assertLockedTaskCheckpoint(task, projectId, systemId, areaId, technicianId, managerId) {
  if (!sameId(task.projectId, projectId) || task.code !== 'DEMO-TASK-EVIDENCE-LOCKED' ||
    task.title !== 'Minh chứng công việc đã duyệt' || task.description !== 'Công việc demo — minh chứng được khóa sau duyệt' ||
    !sameId(task.systemId, systemId) || !sameId(task.areaId, areaId) || !sameId(task.assigneeId, technicianId) ||
    !['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED'].includes(task.status) || task.returnReason != null ||
    (['ASSIGNED', 'IN_PROGRESS'].includes(task.status) && (task.completionNote != null || task.submittedAt != null || task.reviewedAt != null)) ||
    (['SUBMITTED', 'APPROVED'].includes(task.status) && (task.completionNote !== 'Đã hoàn thành bản ghi demo có minh chứng.' || !task.submittedAt)) ||
    (task.status === 'SUBMITTED' && (task.reviewedAt != null || task.reviewedById != null)) ||
    (task.status === 'APPROVED' && (!task.reviewedAt || !sameId(task.reviewedById, managerId)))) fail('Task', task.code);
}

async function seedWorkflow({ root, project, areas, systems, devices, manager, technician, asManager, asTechnician, fetchImpl, apiOrigin, created, preflightOnly = false }) {
  const find = (rows, code) => { const row = rows.find(x => x.code === code); if (!row) fail('Dependency', code); return row; };
  const templates = await asManager('GET', '/checklist-templates');
  for (const category of ['LAN', 'WIFI', 'CAMERA']) {
    if (templates.filter(t => t.category === category && t.isActive).length !== 1) fail('Template revision', category);
  }
  const byCategory = Object.fromEntries(templates.map(t => [t.category, t]));
  const sheets = await asManager('GET', `${root}/inspections`);
  const acceptances = await asManager('GET', `${root}/acceptances`);
  const taskRows = await asManager('GET', `${root}/tasks`);
  const lockTask = taskRows.find(t => t.code === 'DEMO-TASK-EVIDENCE-LOCKED');
  if (lockTask) assertLockedTaskCheckpoint(lockTask, project.id, find(systems, 'LAN-BUILDING').id,
    find(areas, 'T01-SANH').id, technician.user.id, manager.user.id);

  // Read every existing workflow fixture before the first write. Missing fixtures are created below.
  for (const spec of INSPECTIONS) {
    const row = sheets.find(x => x.code === spec.code);
    if (row) {
      assertInspectionCheckpoint(row, spec, byCategory[spec.category], find(systems, spec.systemCode).id,
        spec.areaCode ? find(areas, spec.areaCode).id : null, spec.deviceCode ? find(devices, spec.deviceCode).id : null, technician.user.id);
      if (spec.outcome === 'CLOSED') {
        const issue = row.items.find(x => x.code === byCategory[spec.category].items[0].code)?.issues[0];
        if (issue) {
          const files = await asManager('GET', `${root}/issues/${issue.id}/evidence`);
          const matches = files.filter(x => x.originalName === 'demo-closed-issue.png');
          if (matches.length > 1 || matches.some(x => !matchesEvidence(x, PNG, 'image/png', 'issueId', issue.id, manager.user.id)) ||
            (issue.status !== 'OPEN' && !matches.length)) fail('Issue evidence', spec.code);
        }
      }
    }
  }
  for (const spec of ACCEPTANCES) {
    const row = acceptances.find(x => x.code === spec.code);
    if (!row) continue;
    const sheet = sheets.find(x => x.code === spec.inspectionCode);
    const predecessor = spec.predecessor ? acceptances.find(x => x.code === spec.predecessor) : null;
    if (!sheet || (spec.predecessor && !predecessor)) fail('Acceptance', spec.code);
    const file = row.evidenceIds.length === 1 ? row.snapshot?.content?.evidence?.[0] : null;
    if (spec.evidenceName && row.evidenceIds.length !== 1) fail('Acceptance evidence', spec.code);
    if (file && file.originalName !== spec.evidenceName) fail('Acceptance evidence', spec.code);
    assertAcceptanceCheckpoint(row, spec, find(systems, spec.systemCode).id, sheet.id,
      row.evidenceIds[0] ?? null, predecessor?.id ?? null);
  }
  const activeTask = taskRows.find(t => t.code === 'TASK-LAN-ASSIGNED');
  if (!activeTask && !preflightOnly) fail('Dependency', 'TASK-LAN-ASSIGNED');
  const taskEvidenceRoute = activeTask ? `${root}/tasks/${activeTask.id}/evidence` : null;
  const taskEvidence = activeTask ? await asManager('GET', taskEvidenceRoute) : [];
  const lockedEvidence = lockTask ? await asManager('GET', `${root}/tasks/${lockTask.id}/evidence`) : [];
  const lockedExisting = lockedEvidence.filter(x => x.originalName === 'demo-approved-task.png');
  if (lockedExisting.length > 1 || lockedExisting.some(x => !matchesEvidence(x, PNG, 'image/png', 'taskId', lockTask.id, manager.user.id)) ||
    (lockTask && lockTask.status !== 'ASSIGNED' && !lockedExisting.length)) fail('Task evidence', 'demo-approved-task.png');
  const archiveConfirmed = acceptances.find(a => a.code === 'DEMO-AC-CONFIRMED-V1' && a.status === 'CONFIRMED');
  const evidenceSpecs = [
    { name: 'demo-archived.png', bytes: PNG, mime: 'image/png', route: taskEvidenceRoute, list: taskEvidence },
    { name: 'demo-current.pdf', bytes: PDF, mime: 'application/pdf', route: taskEvidenceRoute, list: taskEvidence },
  ];
  for (const spec of evidenceSpecs) {
    const matches = spec.list.filter(x => x.originalName === spec.name);
    if (matches.length > 1 || matches.some(x => !matchesEvidence(x, spec.bytes, spec.mime, 'taskId', activeTask.id, manager.user.id))) fail('Evidence', spec.name);
    if (spec.name === 'demo-archived.png' && archiveConfirmed && matches.length === 0) {
      const old = archiveConfirmed.snapshot?.content?.evidence?.find(x => x.originalName === spec.name);
      if (!old || old.sha256 !== sha(spec.bytes) || old.sizeBytes !== spec.bytes.length || old.mimeType !== spec.mime ||
        old.caption !== CAPTION || !sameId(old.uploadedById, manager.user.id) ||
        !sameId(old.taskId, activeTask.id) || !archiveConfirmed.evidenceIds.includes(old.id)) fail('Pinned evidence', spec.name);
      const res = await fetchImpl(`${apiOrigin}${root}/acceptances/${archiveConfirmed.id}/files/${old.id}/content`, { headers: { Authorization: `Bearer ${manager.token}` } });
      if (!res.ok || sha(Buffer.from(await res.arrayBuffer())) !== old.sha256) fail('Pinned evidence file', spec.name);
    }
  }
  for (const spec of ACCEPTANCES) {
    const row = acceptances.find(x => x.code === spec.code);
    if (!row || !spec.evidenceName) continue;
    const file = row.status === 'CONFIRMED' ? row.snapshot.content.evidence?.[0] :
      taskEvidence.find(x => sameId(x.id, row.evidenceIds[0]));
    const expectedSha = spec.evidenceName.endsWith('.pdf') ? sha(PDF) : sha(PNG);
    if (!file || file.originalName !== spec.evidenceName || file.sha256 !== expectedSha ||
      file.sizeBytes !== (spec.evidenceName.endsWith('.pdf') ? PDF.length : PNG.length) ||
      file.mimeType !== (spec.evidenceName.endsWith('.pdf') ? 'application/pdf' : 'image/png') || file.caption !== CAPTION ||
      !sameId(file.id, row.evidenceIds[0])) fail('Acceptance evidence', spec.code);
  }
  if (preflightOnly) return;

  const upload = async (spec, token = manager.token) => {
    const key = `demo_${sha(Buffer.from(`${project.code}/${spec.name}`)).slice(0, 40)}`;
    const form = new FormData();
    form.append('file', new Blob([spec.bytes], { type: spec.mime }), spec.name);
    form.append('caption', CAPTION);
    const response = await fetchImpl(`${apiOrigin}${spec.route}`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': key }, body: form, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Evidence ${spec.name} upload failed with HTTP ${response.status}; stop and inspect fixture.`);
    return response.json();
  };
  const evidenceByName = {};
  for (const spec of evidenceSpecs) {
    const existing = spec.list.find(x => x.originalName === spec.name);
    if (existing) evidenceByName[spec.name] = existing;
    else if (spec.name !== 'demo-archived.png' || !archiveConfirmed) {
      evidenceByName[spec.name] = await upload(spec); created.evidence++;
    } else evidenceByName[spec.name] = { id: archiveConfirmed.snapshot.content.evidence.find(x => x.originalName === spec.name).id, deleted: true };
  }

  for (const spec of INSPECTIONS) {
    const template = byCategory[spec.category];
    let sheet = sheets.find(x => x.code === spec.code);
    if (!sheet) {
      sheet = await asManager('POST', `${root}/inspections`, { code: spec.code, title: spec.title,
        systemId: find(systems, spec.systemCode).id, templateId: template.id,
        areaId: spec.areaCode ? find(areas, spec.areaCode).id : null,
        deviceId: spec.deviceCode ? find(devices, spec.deviceCode).id : null });
      sheets.push(sheet); created.inspections++;
    }
    const route = `${root}/inspections/${sheet.id}`;
    const current = async () => asManager('GET', route);
    sheet = await current();
    assertInspectionCheckpoint(sheet, spec, template, find(systems, spec.systemCode).id,
      spec.areaCode ? find(areas, spec.areaCode).id : null, spec.deviceCode ? find(devices, spec.deviceCode).id : null, technician.user.id);
    if (spec.outcome === 'NOT_CHECKED') continue;
    const firstCode = template.items[0].code;
    for (const source of template.items) {
      let item = sheet.items.find(x => x.code === source.code);
      const target = spec.outcome === 'PASS' || (spec.outcome === 'CLOSED' && source.code !== firstCode) ? 'PASS' :
        source.code === firstCode ? 'FAIL' : 'NOT_CHECKED';
      if (target !== 'NOT_CHECKED' && item.result === 'NOT_CHECKED') {
        await asManager('PUT', `${route}/items/${item.id}/result`, { expectedVersion: item.version, result: target,
          note: RESULT_NOTE, ...(target === 'FAIL' ? { issue: { description: ISSUE_DESCRIPTION, assigneeId: technician.user.id } } : {}) });
        created.itemResults++; sheet = await current(); item = sheet.items.find(x => x.code === source.code);
      }
    }
    if (['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(spec.outcome)) {
      let item = sheet.items.find(x => x.code === firstCode);
      let issue = item.activeIssue || item.issues[0];
      const issueRoute = `${root}/issues/${issue.id}`;
      if (spec.outcome === 'CLOSED') {
        const rows = await asManager('GET', `${root}/issues/${issue.id}/evidence`);
        const evidenceSpec = { name: 'demo-closed-issue.png', bytes: PNG, mime: 'image/png', route: `${root}/issues/${issue.id}/evidence`, list: rows };
        const found = rows.filter(x => x.originalName === evidenceSpec.name);
        if (found.length > 1 || found.some(x => !matchesEvidence(x, PNG, 'image/png', 'issueId', issue.id, manager.user.id))) fail('Issue evidence', spec.code);
        if (!found.length) {
          if (issue.status !== 'OPEN') fail('Issue evidence checkpoint', spec.code);
          await upload(evidenceSpec); created.evidence++;
        }
      }
      if (issue.status === 'OPEN' && ['IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(spec.outcome)) {
        issue = await asTechnician('POST', `${issueRoute}/start`, { expectedVersion: issue.version }); created.issueTransitions++;
      }
      if (issue.status === 'IN_PROGRESS' && ['RESOLVED', 'CLOSED'].includes(spec.outcome)) {
        issue = await asTechnician('POST', `${issueRoute}/resolve`, { expectedVersion: issue.version, resolutionNote: RESOLUTION_NOTE }); created.issueTransitions++;
      }
      if (issue.status === 'RESOLVED' && spec.outcome === 'CLOSED') {
        sheet = await current(); item = sheet.items.find(x => x.code === firstCode);
        issue = await asManager('POST', `${issueRoute}/recheck`, { expectedVersion: issue.version,
          expectedItemVersion: item.version, result: 'PASS', note: RECHECK_NOTE }); created.issueTransitions++;
      }
    }
    sheet = await current();
    assertInspectionCheckpoint(sheet, spec, template, find(systems, spec.systemCode).id,
      spec.areaCode ? find(areas, spec.areaCode).id : null, spec.deviceCode ? find(devices, spec.deviceCode).id : null, technician.user.id);
    const first = sheet.items.find(x => x.code === firstCode);
    if (['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(spec.outcome) && first.issues[0]?.status !== spec.outcome) fail('Issue final state', spec.code);
  }

  // The approved Task has an active file uploaded while it was still ASSIGNED.
  let lockedTask = lockTask;
  if (!lockedTask) {
    lockedTask = await asManager('POST', `${root}/tasks`, { code: 'DEMO-TASK-EVIDENCE-LOCKED',
      title: 'Minh chứng công việc đã duyệt', systemId: find(systems, 'LAN-BUILDING').id,
      areaId: find(areas, 'T01-SANH').id, assigneeId: technician.user.id,
      description: 'Công việc demo — minh chứng được khóa sau duyệt' }); created.tasks++;
  }
  const lockedRoute = `${root}/tasks/${lockedTask.id}`;
  const lockedEvidenceRoute = `${lockedRoute}/evidence`;
  const lockedFiles = lockTask ? lockedEvidence : await asManager('GET', lockedEvidenceRoute);
  const lockedMatches = lockedFiles.filter(x => x.originalName === 'demo-approved-task.png');
  if (lockedMatches.length > 1 || lockedMatches.some(x => !matchesEvidence(x, PNG, 'image/png', 'taskId', lockedTask.id, manager.user.id))) fail('Task evidence', lockedTask.code);
  if (!lockedMatches.length) {
    if (lockedTask.status !== 'ASSIGNED') fail('Task evidence checkpoint', lockedTask.code);
    await upload({ name: 'demo-approved-task.png', bytes: PNG, mime: 'image/png', route: lockedEvidenceRoute }); created.evidence++;
  }
  if (lockedTask.status === 'ASSIGNED') { lockedTask = await asTechnician('POST', `${lockedRoute}/start`); created.taskTransitions++; }
  if (lockedTask.status === 'IN_PROGRESS') { lockedTask = await asTechnician('POST', `${lockedRoute}/submit`, { completionNote: 'Đã hoàn thành bản ghi demo có minh chứng.' }); created.taskTransitions++; }
  if (lockedTask.status === 'SUBMITTED') { lockedTask = await asManager('POST', `${lockedRoute}/approve`); created.taskTransitions++; }
  if (lockedTask.status !== 'APPROVED') fail('Task final state', lockedTask.code);

  for (const spec of ACCEPTANCES) {
    const sheet = find(sheets, spec.inspectionCode);
    const sys = find(systems, spec.systemCode);
    const evidence = spec.evidenceName ? evidenceByName[spec.evidenceName] : null;
    const predecessor = spec.predecessor ? find(acceptances, spec.predecessor) : null;
    let row = acceptances.find(x => x.code === spec.code);
    if (!row) {
      if (predecessor) {
        if (predecessor.status !== 'CONFIRMED') fail('Acceptance predecessor', spec.code);
        row = await asManager('POST', `${root}/acceptances/${predecessor.id}/replacement`, {
          code: spec.code, title: spec.title, reason: 'Thay thế hồ sơ demo để minh họa lịch sử phiên bản.',
          inspectionIds: [sheet.id], evidenceIds: evidence ? [evidence.id] : [],
        });
      } else {
        row = await asManager('POST', `${root}/acceptances`, { code: spec.code, title: spec.title,
          systemId: sys.id, inspectionIds: [sheet.id], evidenceIds: evidence ? [evidence.id] : [] });
      }
      acceptances.push(row); created.acceptances++;
    }
    row = await asManager('GET', `${root}/acceptances/${row.id}`);
    assertAcceptanceCheckpoint(row, spec, sys.id, sheet.id, evidence?.id ?? null, predecessor?.id ?? null);
    if (row.status === 'DRAFT' && spec.status === 'CONFIRMED') {
      const ready = await asManager('GET', `${root}/acceptances/${row.id}/readiness`);
      if (!ready.eligible) fail('Acceptance readiness', spec.code);
      row = await asManager('POST', `${root}/acceptances/${row.id}/confirm`, {
        expectedVersion: ready.version, expectedSourceFingerprint: ready.sourceFingerprint });
      created.confirmations++;
    }
    const index = acceptances.findIndex(x => x.code === spec.code);
    acceptances[index] = row;
    if (row.status !== spec.status) fail('Acceptance final state', spec.code);
    if (spec.code === 'DEMO-AC-CONFIRMED-V1' && !evidence?.deleted) {
      await asManager('DELETE', `${root}/evidence/${evidence.id}`, { expectedVersion: evidence.version,
        reason: 'Bản gốc xóa mềm sau khi đã ghim vào hồ sơ demo.' });
      evidenceByName[spec.evidenceName].deleted = true; created.softDeletes++;
    }
  }
  for (const code of ['DEMO-AC-BLOCKED', 'DEMO-AC-READY']) {
    const row = find(acceptances, code);
    const readiness = await asManager('GET', `${root}/acceptances/${row.id}/readiness`);
    if (readiness.eligible !== (code === 'DEMO-AC-READY')) fail('Acceptance readiness', code);
  }
  const historical = find(acceptances, 'DEMO-AC-CONFIRMED-V1');
  const archived = historical.snapshot.content.evidence.find(x => x.originalName === 'demo-archived.png');
  const pinned = await fetchImpl(`${apiOrigin}${root}/acceptances/${historical.id}/files/${archived.id}/content`,
    { headers: { Authorization: `Bearer ${manager.token}` } });
  if (!pinned.ok || sha(Buffer.from(await pinned.arrayBuffer())) !== archived.sha256) fail('Pinned evidence file', historical.code);
  return { inspections: INSPECTIONS.map(x => ({ code: x.code, outcome: x.outcome })),
    acceptances: ACCEPTANCES.map(x => ({ code: x.code, status: x.status })) };
}

module.exports = { seedWorkflow, assertInspectionCheckpoint, assertAcceptanceCheckpoint, matchesEvidence, INSPECTIONS, ACCEPTANCES, PNG, PDF };
