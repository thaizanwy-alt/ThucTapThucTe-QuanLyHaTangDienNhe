// Local, API-only demo fixture. Run after migrations and the two account seed.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const PROJECT_CODE = 'CT-DEMO-ELV-01';
const MARKER = 'DEMO_SEED:ELV-BUILDING-V1 (fictional training data)';
const DEVICE_DESCRIPTION = 'Thiết bị demo — không đại diện hiện trạng thực';
const TASK_DESCRIPTION = 'Công việc demo — giả định quy trình thi công';
const COMPLETION_NOTE = 'Đã kiểm tra theo checklist demo; chờ quản lý xác nhận.';
const RETURN_REASON = 'Nhãn vị trí chưa khớp hồ sơ demo; cần kiểm tra lại.';
const TASK_SPECS = [
  { code: 'TASK-LAN-ASSIGNED', title: 'Gắn nhãn ổ mạng sảnh', systemCode: 'LAN-BUILDING', areaCode: 'T01-SANH', status: 'ASSIGNED' },
  { code: 'TASK-WIFI-STARTED', title: 'Lắp AP tầng 2', systemCode: 'WIFI-BUILDING', areaCode: 'T02-VP', status: 'IN_PROGRESS' },
  { code: 'TASK-CAM-SUBMITTED', title: 'Kiểm tra camera sảnh', systemCode: 'CAMERA-BUILDING', areaCode: 'T01-SANH', status: 'SUBMITTED' },
  { code: 'TASK-CAM-RETURNED', title: 'Khắc phục nhãn camera tầng 2', systemCode: 'CAMERA-BUILDING', areaCode: 'T02-VP', status: 'RETURNED' },
  { code: 'TASK-LAN-APPROVED', title: 'Đấu dây mạng lễ tân', systemCode: 'LAN-BUILDING', areaCode: 'T01-SANH', status: 'APPROVED' },
];
const DEVICE_SPECS = [
  { code: 'RACK-CORE', name: 'Tủ rack trung tâm — tầng 1', type: 'RACK', areaCode: 'T01-KT', capacityU: 42, systems: ['LAN-BUILDING', 'WIFI-BUILDING', 'CAMERA-BUILDING'] },
  { code: 'RACK-T02', name: 'Tủ rack phụ — tầng 2', type: 'RACK', areaCode: 'T02-KT', capacityU: 24, systems: ['LAN-BUILDING', 'WIFI-BUILDING', 'CAMERA-BUILDING'] },
  { code: 'SW-CORE', name: 'Switch trung tâm', type: 'SWITCH', rackCode: 'RACK-CORE', systems: ['LAN-BUILDING', 'WIFI-BUILDING', 'CAMERA-BUILDING'] },
  { code: 'SW-T02', name: 'Switch tầng 2', type: 'SWITCH', rackCode: 'RACK-T02', systems: ['LAN-BUILDING', 'WIFI-BUILDING', 'CAMERA-BUILDING'] },
  { code: 'PP-CORE', name: 'Patch panel trung tâm', type: 'PATCH_PANEL', rackCode: 'RACK-CORE', systems: ['LAN-BUILDING', 'CAMERA-BUILDING'] },
  { code: 'PP-T02', name: 'Patch panel tầng 2', type: 'PATCH_PANEL', rackCode: 'RACK-T02', systems: ['LAN-BUILDING', 'CAMERA-BUILDING'] },
  { code: 'OUT-LOBBY', name: 'Ổ mạng quầy lễ tân', type: 'NETWORK_OUTLET', areaCode: 'T01-SANH', systems: ['LAN-BUILDING'] },
  { code: 'OUT-CAM-T02', name: 'Ổ mạng cấp camera tầng 2', type: 'NETWORK_OUTLET', areaCode: 'T02-VP', systems: ['CAMERA-BUILDING'] },
  { code: 'OUT-PENDING', name: 'Ổ mạng chưa đấu dây nhảy', type: 'NETWORK_OUTLET', areaCode: 'T02-VP', systems: ['LAN-BUILDING'] },
  { code: 'AP-T02', name: 'AP khu văn phòng tầng 2', type: 'AP', areaCode: 'T02-VP', systems: ['WIFI-BUILDING'] },
  { code: 'CAM-DIRECT', name: 'Camera sảnh — cắm switch trực tiếp', type: 'CAMERA', areaCode: 'T01-SANH', systems: ['CAMERA-BUILDING'] },
  { code: 'CAM-OUTLET', name: 'Camera tầng 2 — qua ổ mạng', type: 'CAMERA', areaCode: 'T02-VP', systems: ['CAMERA-BUILDING'] },
  { code: 'CAM-PANEL', name: 'Camera tầng 1 — qua panel', type: 'CAMERA', areaCode: 'T01-SANH', systems: ['CAMERA-BUILDING'] },
  { code: 'UPS-CORE', name: 'UPS tủ trung tâm', type: 'UPS', rackCode: 'RACK-CORE', systems: ['LAN-BUILDING', 'CAMERA-BUILDING'] },
  { code: 'NVR-CORE', name: 'Đầu ghi minh họa', type: 'NVR', rackCode: 'RACK-CORE', systems: ['CAMERA-BUILDING'] },
  { code: 'RTR-CORE', name: 'Router tủ trung tâm', type: 'ROUTER', rackCode: 'RACK-CORE', systems: ['LAN-BUILDING'] },
  { code: 'ODF-CORE', name: 'Hộp phối quang trung tâm', type: 'ODF', rackCode: 'RACK-CORE', systems: ['LAN-BUILDING'] },
  { code: 'CM-CORE', name: 'Thanh quản lý cáp', type: 'CABLE_MANAGER', rackCode: 'RACK-CORE', systems: ['LAN-BUILDING'] },
  { code: 'SHELF-CORE', name: 'Khay tủ chưa xếp', type: 'SHELF', rackCode: 'RACK-CORE', systems: ['LAN-BUILDING'] },
  { code: 'PDU-CORE', name: 'PDU dọc tủ trung tâm', type: 'PDU', rackCode: 'RACK-CORE', systems: ['LAN-BUILDING'] },
  { code: 'ODF-T02', name: 'Hộp phối quang tầng 2 chưa xếp', type: 'ODF', rackCode: 'RACK-T02', systems: ['LAN-BUILDING'] },
];

const RACK_LAYOUT = [
  { code: 'RACK-CORE', rackRole: 'MAIN', parentCode: null, areaCode: 'T01-KT', capacityU: 42, servedAreaCodes: ['T01-KT', 'T01-SANH'] },
  { code: 'RACK-T02', rackRole: 'SUB', parentCode: 'RACK-CORE', areaCode: 'T02-KT', capacityU: 24, servedAreaCodes: ['T02-KT', 'T02-VP'] },
];
const PLACEMENT = [
  { code: 'UPS-CORE', rackCode: 'RACK-CORE', mountMode: 'U', startU: 1, heightU: 2 },
  { code: 'NVR-CORE', rackCode: 'RACK-CORE', mountMode: 'U', startU: 4, heightU: 2 },
  { code: 'RTR-CORE', rackCode: 'RACK-CORE', mountMode: 'U', startU: 8, heightU: 1 },
  { code: 'CM-CORE', rackCode: 'RACK-CORE', mountMode: 'U', startU: 39, heightU: 1 },
  { code: 'SW-CORE', rackCode: 'RACK-CORE', mountMode: 'U', startU: 40, heightU: 1 },
  { code: 'PP-CORE', rackCode: 'RACK-CORE', mountMode: 'U', startU: 41, heightU: 1 },
  { code: 'ODF-CORE', rackCode: 'RACK-CORE', mountMode: 'U', startU: 42, heightU: 1 },
  { code: 'PDU-CORE', rackCode: 'RACK-CORE', mountMode: 'ZERO_U', startU: null, heightU: 0 },
  { code: 'SHELF-CORE', rackCode: 'RACK-CORE', mountMode: null, startU: null, heightU: null },
  { code: 'SW-T02', rackCode: 'RACK-T02', mountMode: 'U', startU: 22, heightU: 1 },
  { code: 'PP-T02', rackCode: 'RACK-T02', mountMode: 'U', startU: 24, heightU: 1 },
  { code: 'ODF-T02', rackCode: 'RACK-T02', mountMode: null, startU: null, heightU: null },
];

const normalizedId = value => value == null ? null : value.toLowerCase();
const normalizedIds = values => values.map(value => value.toLowerCase()).sort();

function assertDeviceFixture(item, fixture) {
  const fields = ['code', 'type', 'name', 'brand', 'model', 'serialNumber', 'description', 'locationNote', 'capacityU'];
  const sameFields = fields.every(field => (item[field] ?? null) === (fixture[field] ?? null));
  const sameLocation = normalizedId(item.areaId) === normalizedId(fixture.areaId) &&
    normalizedId(item.rackId) === normalizedId(fixture.rackId);
  const actualSystems = Array.isArray(item.systemIds) ? normalizedIds(item.systemIds) : null;
  const expectedSystems = normalizedIds(fixture.systemIds);
  if (!sameFields || !sameLocation || actualSystems === null ||
    actualSystems.length !== expectedSystems.length || actualSystems.some((id, index) => id !== expectedSystems[index])) {
    throw new Error(`Device code ${fixture.code} conflicts with the demo fixture; refusing to reuse it.`);
  }
}

function resolveDeviceFixture(spec, areas, systems, devices) {
  const lookup = (rows, code) => {
    const item = rows.find(value => value.code === code);
    if (!item) throw new Error(`Device code ${spec.code} conflicts with the demo fixture: missing ${code}.`);
    return item.id;
  };
  return {
    code: spec.code, name: spec.name, type: spec.type,
    areaId: spec.areaCode ? lookup(areas, spec.areaCode) : null,
    rackId: spec.rackCode ? lookup(devices, spec.rackCode) : null,
    capacityU: spec.capacityU ?? null,
    systemIds: spec.systems.map(code => lookup(systems, code)),
    description: DEVICE_DESCRIPTION,
    brand: null, model: null, serialNumber: null, locationNote: null,
  };
}

function preflightExistingDevices(specs, areas, systems, devices) {
  for (const spec of specs) {
    const existing = devices.find(item => item.code === spec.code);
    if (existing) assertDeviceFixture(existing, resolveDeviceFixture(spec, areas, systems, devices));
  }
}

function sameIds(a, b) {
  const left = normalizedIds(a || []);
  const right = normalizedIds(b || []);
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function assertLayoutPreflight(areas, devices, racks, layouts = []) {
  const byCode = (rows, code) => rows.find(item => item.code === code);
  for (const spec of RACK_LAYOUT) {
    const rack = byCode(devices, spec.code);
    if (!rack) continue;
    const current = byCode(racks, spec.code);
    if (!current || normalizedId(current.id) !== normalizedId(rack.id)) throw new Error(`Rack ${spec.code} conflicts with demo layout.`);
    const parentId = spec.parentCode ? byCode(devices, spec.parentCode)?.id : null;
    const served = spec.servedAreaCodes.map(code => byCode(areas, code)?.id);
    if (served.some(id => !id) || (spec.parentCode && !parentId)) throw new Error(`Rack ${spec.code} conflicts with demo layout: missing fixture dependency.`);
    const pristine = current.rackRole == null && current.parentRackId == null && sameIds(current.servedAreaIds, []);
    const configured = current.rackRole === spec.rackRole && normalizedId(current.parentRackId) === normalizedId(parentId) &&
      normalizedId(current.areaId) === normalizedId(byCode(areas, spec.areaCode)?.id) && current.capacityU === spec.capacityU &&
      sameIds(current.servedAreaIds, served);
    if (!pristine && !configured) throw new Error(`Rack ${spec.code} conflicts with demo layout; refusing to overwrite it.`);
  }
  for (const spec of PLACEMENT) {
    const device = byCode(devices, spec.code);
    if (!device) continue;
    const pristine = device.mountMode == null && device.startU == null && device.heightU == null;
    const placed = device.mountMode === spec.mountMode && (device.startU ?? null) === spec.startU &&
      (device.heightU ?? null) === spec.heightU && normalizedId(device.rackId) === normalizedId(byCode(devices, spec.rackCode)?.id);
    if (!pristine && !placed) throw new Error(`Device ${spec.code} conflicts with demo U layout; refusing to overwrite it.`);
  }
  for (const spec of RACK_LAYOUT) {
    const occupied = PLACEMENT.filter(item => item.rackCode === spec.code && item.mountMode === 'U');
    for (const item of occupied) {
      if (item.startU < 1 || item.heightU < 1 || item.startU + item.heightU - 1 > spec.capacityU) {
        throw new Error(`Rack ${spec.code} lacks capacity for ${item.code}.`);
      }
      if (occupied.some(other => other.code !== item.code && item.startU <= other.startU + other.heightU - 1 &&
        other.startU <= item.startU + item.heightU - 1)) throw new Error(`Rack ${spec.code} demo U plan overlaps.`);
    }
    const layout = layouts.find(item => item.rack.code === spec.code);
    if (!layout) continue;
    for (const existing of layout.positioned) {
      if (occupied.some(item => item.code !== existing.code && item.startU <= existing.startU + existing.heightU - 1 &&
        existing.startU <= item.startU + item.heightU - 1)) {
        throw new Error(`Rack ${spec.code} U conflicts with existing Device ${existing.code}; refusing to overwrite it.`);
      }
    }
  }
}

function requireManagedProject(project) {
  if (project.description !== MARKER) {
    throw new Error(`${PROJECT_CODE} already exists but is not managed by this demo seed; no data was changed.`);
  }
  if (project.status !== 'IN_PROGRESS') throw new Error('Demo project status was changed; refusing to overwrite it.');
  if (project.name !== 'Tòa nhà minh họa hạ tầng điện nhẹ' || project.address !== 'Địa chỉ giả định — chỉ dùng demo') {
    throw new Error(`Project ${PROJECT_CODE} conflicts with the demo fixture; no data was changed.`);
  }
}

function assertTaskCheckpoint(item, spec, projectId, technicianId, managerId) {
  const progress = ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED'];
  const allowed = spec.status === 'RETURNED' || spec.status === 'APPROVED'
    ? [...progress, spec.status] : progress.slice(0, progress.indexOf(spec.status) + 1);
  const createdAt = Date.parse(item.createdAt);
  const updatedAt = Date.parse(item.updatedAt);
  const submittedAt = item.submittedAt == null ? null : Date.parse(item.submittedAt);
  const reviewedAt = item.reviewedAt == null ? null : Date.parse(item.reviewedAt);
  const baseMatches = item.code === spec.code && normalizedId(item.projectId) === normalizedId(projectId) &&
    item.title === spec.title && item.description === TASK_DESCRIPTION &&
    normalizedId(item.systemId) === normalizedId(spec.systemId) &&
    normalizedId(item.areaId) === normalizedId(spec.areaId) &&
    normalizedId(item.assigneeId) === normalizedId(technicianId) &&
    Number.isFinite(createdAt) && Number.isFinite(updatedAt) && createdAt <= updatedAt && allowed.includes(item.status);
  let checkpointMatches = false;
  if (item.status === 'ASSIGNED' || item.status === 'IN_PROGRESS') {
    checkpointMatches = item.completionNote == null && item.returnReason == null && submittedAt === null &&
      item.reviewedById == null && reviewedAt === null;
  } else if (item.status === 'SUBMITTED' || item.status === 'RETURNED' || item.status === 'APPROVED') {
    checkpointMatches = item.completionNote === COMPLETION_NOTE && Number.isFinite(submittedAt) &&
      submittedAt >= createdAt && submittedAt <= updatedAt;
    if (item.status === 'SUBMITTED') {
      checkpointMatches &&= item.returnReason == null && item.reviewedById == null && reviewedAt === null;
    } else {
      checkpointMatches &&= item.returnReason === (item.status === 'RETURNED' ? RETURN_REASON : null) &&
        normalizedId(item.reviewedById) === normalizedId(managerId) && Number.isFinite(reviewedAt) &&
        reviewedAt >= submittedAt && reviewedAt <= updatedAt;
    }
  }
  if (!baseMatches || !checkpointMatches) {
    throw new Error(`Task ${spec.code} conflicts with the demo checkpoint; refusing to change it.`);
  }
}

async function preflightExistingDependents(get, root, projectId, areas, systems, devices, technicianId, managerId) {
  const find = (rows, code) => rows.find(item => item.code === code);
  const portSpecs = [
    ['OUT-LOBBY', 'P01'], ['OUT-CAM-T02', 'P01'], ['OUT-PENDING', 'P01'],
    ['PP-CORE', 'P01'], ['PP-CORE', 'P02'], ['PP-T02', 'P01'], ['PP-T02', 'P02'],
    ['SW-CORE', 'ETH1', 10, false, 'Cổng LAN lễ tân'],
    ['SW-CORE', 'ETH2', 30, true, 'Camera sảnh'],
    ['SW-CORE', 'ETH3', 30, true, 'Camera qua panel'],
    ['SW-T02', 'ETH1', 30, true, 'Camera tầng 2'],
    ['SW-T02', 'ETH2', 20, true, 'AP tầng 2'],
    ['AP-T02', 'ETH1'], ['CAM-DIRECT', 'ETH1'], ['CAM-OUTLET', 'ETH1'], ['CAM-PANEL', 'ETH1'],
  ];
  const ports = new Map();
  for (const deviceCode of [...new Set(portSpecs.map(item => item[0]))]) {
    const device = find(devices, deviceCode);
    if (!device) continue;
    for (const port of await get(`${root}/devices/${device.id}/ports`)) ports.set(`${deviceCode}/${port.code}`, port);
  }
  for (const [deviceCode, code, vlan, poe, description] of portSpecs) {
    const item = ports.get(`${deviceCode}/${code}`);
    if (!item) continue;
    const owner = find(devices, deviceCode);
    if (normalizedId(item.projectId) !== normalizedId(projectId) || normalizedId(item.deviceId) !== normalizedId(owner.id) ||
      (item.accessVlanId ?? null) !== (vlan ?? null) || (item.poeEnabled ?? null) !== (poe ?? null) ||
      (item.description ?? null) !== (description ?? null)) {
      throw new Error(`Port ${deviceCode}/${code} conflicts with the demo fixture; no data was changed.`);
    }
  }
  const wireSpecs = [
    ['DEMO-OUT-LOBBY-REAR', 'FIXED', 'OUT-LOBBY/P01', 'REAR', 'PP-CORE/P01', 'REAR'],
    ['DEMO-OUT-LOBBY-PATCH', 'PATCH', 'PP-CORE/P01', 'FRONT', 'SW-CORE/ETH1', 'SINGLE'],
    ['DEMO-CAM-DIRECT', 'FIXED', 'CAM-DIRECT/ETH1', 'SINGLE', 'SW-CORE/ETH2', 'SINGLE'],
    ['DEMO-CAM-OUTLET', 'PATCH', 'CAM-OUTLET/ETH1', 'SINGLE', 'OUT-CAM-T02/P01', 'FRONT'],
    ['DEMO-CAM-OUTLET-REAR', 'FIXED', 'OUT-CAM-T02/P01', 'REAR', 'PP-T02/P01', 'REAR'],
    ['DEMO-CAM-OUTLET-PATCH', 'PATCH', 'PP-T02/P01', 'FRONT', 'SW-T02/ETH1', 'SINGLE'],
    ['DEMO-CAM-PANEL', 'FIXED', 'CAM-PANEL/ETH1', 'SINGLE', 'PP-CORE/P02', 'REAR'],
    ['DEMO-CAM-PANEL-PATCH', 'PATCH', 'PP-CORE/P02', 'FRONT', 'SW-CORE/ETH3', 'SINGLE'],
    ['DEMO-AP-T02', 'PATCH', 'AP-T02/ETH1', 'SINGLE', 'SW-T02/ETH2', 'SINGLE'],
    ['DEMO-OUT-PENDING', 'FIXED', 'OUT-PENDING/P01', 'REAR', 'PP-T02/P02', 'REAR'],
  ];
  const connections = await get(`${root}/connections`);
  for (const [label, kind, aCode, aSide, bCode, bSide] of wireSpecs) {
    const item = connections.find(value => value.label === label);
    if (!item) continue;
    const aId = ports.get(aCode)?.id;
    const bId = ports.get(bCode)?.id;
    const endpoint = value => `${normalizedId(value.portId)}:${value.side}`;
    const expected = aId && bId ? [`${normalizedId(aId)}:${aSide}`, `${normalizedId(bId)}:${bSide}`].sort() : [];
    const actual = item.a && item.b ? [endpoint(item.a), endpoint(item.b)].sort() : [];
    if (normalizedId(item.projectId) !== normalizedId(projectId) || item.kind !== kind ||
      item.description !== 'Dây demo được khai báo; chưa xác nhận thực tế' || expected.length !== 2 ||
      actual.length !== 2 || actual.some((value, index) => value !== expected[index])) {
      throw new Error(`Connection ${label} conflicts with the demo fixture; no data was changed.`);
    }
  }
  const profileSpecs = [
    ['CAM-DIRECT', 'STATIC', '192.0.2.21', 'AA:BB:CC:DD:EE:21'],
    ['CAM-OUTLET', 'DHCP', null, 'AA:BB:CC:DD:EE:22'],
    ['CAM-PANEL', 'STATIC', '192.0.2.23', 'AA:BB:CC:DD:EE:23'],
    ['AP-T02', 'DHCP', null, 'AA:BB:CC:DD:EE:24'],
  ];
  for (const [code, addressMode, ipAddress, macAddress] of profileSpecs) {
    const owner = find(devices, code);
    if (!owner) continue;
    const item = await get(`${root}/devices/${owner.id}/network-profile`);
    if (item && (normalizedId(item.projectId) !== normalizedId(projectId) ||
      item.addressMode !== addressMode || item.ipAddress !== ipAddress || item.macAddress !== macAddress)) {
      throw new Error(`Network profile ${code} conflicts with the demo fixture; no data was changed.`);
    }
  }
  const tasks = await get(`${root}/tasks`);
  for (const spec of TASK_SPECS) {
    const item = find(tasks, spec.code);
    if (!item) continue;
    assertTaskCheckpoint(item, {
      ...spec, systemId: find(systems, spec.systemCode)?.id, areaId: find(areas, spec.areaCode)?.id,
    }, projectId, technicianId, managerId);
  }
}

async function seedDemoTasks({ root, projectId, taskDefinitions, technicianId, managerId, asManager, asTechnician, created }) {
  const tasks = await asManager('GET', `${root}/tasks`);
  for (const spec of taskDefinitions) {
    const existing = tasks.find(item => item.code === spec.code);
    if (existing) assertTaskCheckpoint(existing, spec, projectId, technicianId, managerId);
  }
  for (const spec of taskDefinitions) {
    let item = tasks.find(value => value.code === spec.code);
    if (!item) {
      item = await asManager('POST', `${root}/tasks`, {
        code: spec.code, title: spec.title, systemId: spec.systemId, areaId: spec.areaId,
        assigneeId: technicianId, description: TASK_DESCRIPTION,
      });
      tasks.push(item);
      created.tasks++;
    }
    assertTaskCheckpoint(item, spec, projectId, technicianId, managerId);
    const route = `${root}/tasks/${item.id}`;
    if (item.status === 'ASSIGNED' && spec.status !== 'ASSIGNED') {
      item = await asTechnician('POST', `${route}/start`);
      created.taskTransitions++;
    }
    if (item.status === 'IN_PROGRESS' && !['ASSIGNED', 'IN_PROGRESS'].includes(spec.status)) {
      item = await asTechnician('POST', `${route}/submit`, { completionNote: COMPLETION_NOTE });
      created.taskTransitions++;
    }
    if (item.status === 'SUBMITTED' && spec.status === 'RETURNED') {
      item = await asManager('POST', `${route}/return`, { reason: RETURN_REASON });
      created.taskTransitions++;
    }
    if (item.status === 'SUBMITTED' && spec.status === 'APPROVED') {
      item = await asManager('POST', `${route}/approve`);
      created.taskTransitions++;
    }
    assertTaskCheckpoint(item, spec, projectId, technicianId, managerId);
    if (item.status !== spec.status) throw new Error(`Task ${spec.code} has unexpected status ${item.status}; refusing to change it further.`);
  }
  return tasks;
}

async function main({ envOverride = {}, fetchImpl = fetch } = {}) {
  const envPath = path.resolve(__dirname, '../.env');
  const env = { ...(fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {}), ...process.env, ...envOverride };
  const url = new URL(env.DEMO_API_URL || 'http://localhost:3000');
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('DEMO_API_URL must be a local HTTP address.');
  }
  if (!env.DEMO_MANAGER_PASSWORD || !env.DEMO_TECHNICIAN_PASSWORD) {
    throw new Error('Set both demo account passwords in backend/.env before running seed:demo.');
  }
  const base = url.origin;
  const call = async (method, route, body, token) => {
    const response = await fetchImpl(base + route, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`${method} ${route} failed with HTTP ${response.status}; seed stopped without changing existing records.`);
    return response.status === 204 ? null : response.json();
  };
  const health = await call('GET', '/health');
  if (health.status !== 'ok' || health.database !== 'connected') throw new Error('Backend health/database is not ready.');
  const login = async (email, password, role) => {
    const { accessToken } = await call('POST', '/auth/login', { email, password });
    const user = await call('GET', '/auth/me', undefined, accessToken);
    if (user.role !== role) throw new Error(`Demo ${role} account has an unexpected role.`);
    return { token: accessToken, user };
  };
  const manager = await login(env.DEMO_MANAGER_EMAIL || 'manager.demo@example.local', env.DEMO_MANAGER_PASSWORD, 'MANAGER');
  const technician = await login(env.DEMO_TECHNICIAN_EMAIL || 'technician.demo@example.local', env.DEMO_TECHNICIAN_PASSWORD, 'TECHNICIAN');
  const active = await call('GET', '/users/technicians', undefined, manager.token);
  if (!active.some(user => user.id === technician.user.id)) throw new Error('Demo technician is not active; seed stopped.');
  const asManager = (method, route, body) => call(method, route, body, manager.token);
  const asTechnician = (method, route, body) => call(method, route, body, technician.token);
  const created = { project: 0, areas: 0, systems: 0, devices: 0, ports: 0, connections: 0, profiles: 0, tasks: 0,
    taskTransitions: 0, rackUpdates: 0, placements: 0 };

  const projects = await asManager('GET', '/projects');
  let project = projects.find(item => item.code === PROJECT_CODE);
  if (project) requireManagedProject(project);
  else {
    project = await asManager('POST', '/projects', {
      code: PROJECT_CODE, name: 'Tòa nhà minh họa hạ tầng điện nhẹ',
      address: 'Địa chỉ giả định — chỉ dùng demo', status: 'IN_PROGRESS', description: MARKER,
    });
    created.project++;
  }
  const root = `/projects/${project.id}`;
  const areas = await asManager('GET', `${root}/areas`);
  const systems = await asManager('GET', `${root}/systems`);
  const devices = await asManager('GET', `${root}/devices`);
  const areaSpecs = [
    ['T01', 'Tầng 1 — sảnh và kỹ thuật trung tâm', 'FLOOR', null, 1],
    ['T02', 'Tầng 2 — khu làm việc', 'FLOOR', null, 2],
    ['T01-KT', 'Phòng kỹ thuật trung tâm', 'ROOM', 'T01', 1],
    ['T01-SANH', 'Sảnh tầng 1', 'ROOM', 'T01', 2],
    ['T02-VP', 'Văn phòng tầng 2', 'ROOM', 'T02', 1],
    ['T02-KT', 'Phòng kỹ thuật tầng 2', 'ROOM', 'T02', 2],
  ];
  for (const [code, name, type, parentCode, sortOrder] of areaSpecs) {
    const item = areas.find(value => value.code === code);
    if (!item) continue;
    const parentId = parentCode ? areas.find(value => value.code === parentCode)?.id : null;
    if (item.projectId?.toLowerCase() !== project.id.toLowerCase() || item.name !== name || item.type !== type ||
      item.sortOrder !== sortOrder || (parentCode && !parentId) || normalizedId(item.parentId) !== normalizedId(parentId)) {
      throw new Error(`Area ${code} conflicts with the demo fixture; no data was changed.`);
    }
  }
  const systemSpecs = [
    ['LAN-BUILDING', 'Mạng LAN tòa nhà', 'LAN'],
    ['WIFI-BUILDING', 'WiFi khu làm việc', 'WIFI'],
    ['CAMERA-BUILDING', 'Camera an ninh', 'CAMERA'],
  ];
  for (const [code, name, category] of systemSpecs) {
    const item = systems.find(value => value.code === code);
    if (item && (item.projectId?.toLowerCase() !== project.id.toLowerCase() || item.name !== name ||
      item.category !== category || item.description !== 'Hạng mục demo — dữ liệu giả định')) {
      throw new Error(`System ${code} conflicts with the demo fixture; no data was changed.`);
    }
  }
  preflightExistingDevices(DEVICE_SPECS, areas, systems, devices);
  const racksBefore = await asManager('GET', `${root}/racks`);
  const layoutsBefore = await Promise.all(racksBefore.filter(item => RACK_LAYOUT.some(spec => spec.code === item.code))
    .map(item => asManager('GET', `${root}/racks/${item.id}/layout`)));
  assertLayoutPreflight(areas, devices, racksBefore, layoutsBefore);
  await preflightExistingDependents(route => asManager('GET', route), root, project.id, areas, systems, devices,
    technician.user.id, manager.user.id);
  const ensure = async (rows, key, route, body, counter, check) => {
    let item = rows.find(value => value.code === key);
    if (item) { check(item); return item; }
    item = await asManager('POST', route, body);
    check(item);
    rows.push(item);
    created[counter]++;
    return item;
  };
  const sameProject = item => {
    if (item.projectId?.toLowerCase() !== project.id.toLowerCase()) throw new Error(`Fixture ${item.code || item.label} belongs to another project.`);
  };

  const floor = async (code, name, sortOrder) => ensure(areas, code, `${root}/areas`,
    { code, name, type: 'FLOOR', parentId: null, sortOrder }, 'areas', item => {
      sameProject(item);
      if (item.type !== 'FLOOR' || item.parentId !== null || item.name !== name) throw new Error(`Area code ${code} was changed; refusing to reuse it.`);
    });
  const room = async (code, name, parent, sortOrder) => ensure(areas, code, `${root}/areas`,
    { code, name, type: 'ROOM', parentId: parent.id, sortOrder }, 'areas', item => {
      sameProject(item);
      if (item.type !== 'ROOM' || item.parentId?.toLowerCase() !== parent.id.toLowerCase() || item.name !== name) {
        throw new Error(`Area code ${code} was changed; refusing to reuse it.`);
      }
    });
  const f1 = await floor('T01', 'Tầng 1 — sảnh và kỹ thuật trung tâm', 1);
  const f2 = await floor('T02', 'Tầng 2 — khu làm việc', 2);
  const coreRoom = await room('T01-KT', 'Phòng kỹ thuật trung tâm', f1, 1);
  const lobby = await room('T01-SANH', 'Sảnh tầng 1', f1, 2);
  const office = await room('T02-VP', 'Văn phòng tầng 2', f2, 1);
  const auxRoom = await room('T02-KT', 'Phòng kỹ thuật tầng 2', f2, 2);

  const system = (code, name, category) => ensure(systems, code, `${root}/systems`,
    { code, name, category, description: 'Hạng mục demo — dữ liệu giả định' }, 'systems', item => {
      sameProject(item);
      if (item.category !== category || item.name !== name) throw new Error(`System code ${code} was changed; refusing to reuse it.`);
    });
  const lan = await system('LAN-BUILDING', 'Mạng LAN tòa nhà', 'LAN');
  const wifi = await system('WIFI-BUILDING', 'WiFi khu làm việc', 'WIFI');
  const camera = await system('CAMERA-BUILDING', 'Camera an ninh', 'CAMERA');

  const device = spec => {
    const body = resolveDeviceFixture(spec, areas, systems, devices);
    return ensure(devices, spec.code, `${root}/devices`, body, 'devices', item => {
      sameProject(item);
      assertDeviceFixture(item, body);
    });
  };
  const fixtureDevices = {};
  for (const spec of DEVICE_SPECS) fixtureDevices[spec.code] = await device(spec);
  for (const spec of RACK_LAYOUT) {
    const rack = fixtureDevices[spec.code];
    const current = (await asManager('GET', `${root}/racks`)).find(item => item.code === spec.code);
    if (current.rackRole === spec.rackRole) continue;
    const body = {
      rackRole: spec.rackRole,
      parentRackId: spec.parentCode ? fixtureDevices[spec.parentCode].id : null,
      areaId: areas.find(item => item.code === spec.areaCode).id,
      capacityU: spec.capacityU,
      servedAreaIds: spec.servedAreaCodes.map(code => areas.find(item => item.code === code).id),
    };
    await asManager('PATCH', `${root}/racks/${rack.id}`, body);
    created.rackUpdates++;
  }
  for (const spec of PLACEMENT) {
    const item = fixtureDevices[spec.code];
    if (item.mountMode === spec.mountMode && (item.startU ?? null) === spec.startU && (item.heightU ?? null) === spec.heightU) continue;
    const placed = await asManager('PUT', `${root}/devices/${item.id}/placement`, {
      areaId: null, rackId: fixtureDevices[spec.rackCode].id,
      mountMode: spec.mountMode, startU: spec.startU, heightU: spec.heightU,
    });
    Object.assign(item, placed);
    created.placements++;
  }
  const [outLobby, outCamera, outPending, ap, camDirect, camOutlet, camPanel] =
    ['OUT-LOBBY', 'OUT-CAM-T02', 'OUT-PENDING', 'AP-T02', 'CAM-DIRECT', 'CAM-OUTLET', 'CAM-PANEL'].map(code => fixtureDevices[code]);
  const [ppCore, ppAux, swCore, swAux] =
    ['PP-CORE', 'PP-T02', 'SW-CORE', 'SW-T02'].map(code => fixtureDevices[code]);

  const portCache = new Map();
  const port = async (owner, code, metadata = {}) => {
    if (!portCache.has(owner.id)) portCache.set(owner.id, await asManager('GET', `${root}/devices/${owner.id}/ports`));
    const rows = portCache.get(owner.id);
    return ensure(rows, code, `${root}/devices/${owner.id}/ports`, { code, ...metadata }, 'ports', item => {
      sameProject(item);
      if (item.deviceId.toLowerCase() !== owner.id.toLowerCase()) throw new Error(`Port ${owner.code}/${code} belongs to another device.`);
      if (owner.type === 'SWITCH' && (item.accessVlanId !== metadata.accessVlanId || item.poeEnabled !== metadata.poeEnabled)) {
        throw new Error(`Switch port ${owner.code}/${code} was changed; refusing to reuse it.`);
      }
    });
  };
  const p = {};
  p.outLobby = await port(outLobby, 'P01');
  p.outCamera = await port(outCamera, 'P01');
  p.outPending = await port(outPending, 'P01');
  p.ppCore1 = await port(ppCore, 'P01');
  p.ppCore2 = await port(ppCore, 'P02');
  p.ppAux1 = await port(ppAux, 'P01');
  p.ppAux2 = await port(ppAux, 'P02');
  p.swCore1 = await port(swCore, 'ETH1', { accessVlanId: 10, poeEnabled: false, description: 'Cổng LAN lễ tân' });
  p.swCore2 = await port(swCore, 'ETH2', { accessVlanId: 30, poeEnabled: true, description: 'Camera sảnh' });
  p.swCore3 = await port(swCore, 'ETH3', { accessVlanId: 30, poeEnabled: true, description: 'Camera qua panel' });
  p.swAux1 = await port(swAux, 'ETH1', { accessVlanId: 30, poeEnabled: true, description: 'Camera tầng 2' });
  p.swAux2 = await port(swAux, 'ETH2', { accessVlanId: 20, poeEnabled: true, description: 'AP tầng 2' });
  p.ap = await port(ap, 'ETH1');
  p.camDirect = await port(camDirect, 'ETH1');
  p.camOutlet = await port(camOutlet, 'ETH1');
  p.camPanel = await port(camPanel, 'ETH1');

  const connections = await asManager('GET', `${root}/connections`);
  const end = (value, side) => ({ portId: value.id, side });
  const wire = async (label, kind, a, b) => {
    const existing = connections.find(item => item.label === label);
    const body = { label, kind, a, b, description: 'Dây demo được khai báo; chưa xác nhận thực tế' };
    if (existing) {
      sameProject(existing);
      const key = x => `${x.portId.toLowerCase()}:${x.side}`;
      if (existing.kind !== kind || ![key(existing.a), key(existing.b)].includes(key(a)) ||
        ![key(existing.a), key(existing.b)].includes(key(b))) throw new Error(`Connection ${label} was changed; refusing to reuse it.`);
      return existing;
    }
    const item = await asManager('POST', `${root}/connections`, body);
    connections.push(item); created.connections++;
    return item;
  };
  await wire('DEMO-OUT-LOBBY-REAR', 'FIXED', end(p.outLobby, 'REAR'), end(p.ppCore1, 'REAR'));
  await wire('DEMO-OUT-LOBBY-PATCH', 'PATCH', end(p.ppCore1, 'FRONT'), end(p.swCore1, 'SINGLE'));
  await wire('DEMO-CAM-DIRECT', 'FIXED', end(p.camDirect, 'SINGLE'), end(p.swCore2, 'SINGLE'));
  await wire('DEMO-CAM-OUTLET', 'PATCH', end(p.camOutlet, 'SINGLE'), end(p.outCamera, 'FRONT'));
  await wire('DEMO-CAM-OUTLET-REAR', 'FIXED', end(p.outCamera, 'REAR'), end(p.ppAux1, 'REAR'));
  await wire('DEMO-CAM-OUTLET-PATCH', 'PATCH', end(p.ppAux1, 'FRONT'), end(p.swAux1, 'SINGLE'));
  await wire('DEMO-CAM-PANEL', 'FIXED', end(p.camPanel, 'SINGLE'), end(p.ppCore2, 'REAR'));
  await wire('DEMO-CAM-PANEL-PATCH', 'PATCH', end(p.ppCore2, 'FRONT'), end(p.swCore3, 'SINGLE'));
  await wire('DEMO-AP-T02', 'PATCH', end(p.ap, 'SINGLE'), end(p.swAux2, 'SINGLE'));
  await wire('DEMO-OUT-PENDING', 'FIXED', end(p.outPending, 'REAR'), end(p.ppAux2, 'REAR'));

  const profile = async (owner, body) => {
    const route = `${root}/devices/${owner.id}/network-profile`;
    const existing = await asManager('GET', route);
    if (existing) {
      if (Object.keys(body).some(key => existing[key] !== body[key])) throw new Error(`Network profile ${owner.code} was changed; refusing to overwrite it.`);
      return;
    }
    await asManager('PUT', route, body);
    created.profiles++;
  };
  await profile(camDirect, { addressMode: 'STATIC', ipAddress: '192.0.2.21', macAddress: 'AA:BB:CC:DD:EE:21' });
  await profile(camOutlet, { addressMode: 'DHCP', ipAddress: null, macAddress: 'AA:BB:CC:DD:EE:22' });
  await profile(camPanel, { addressMode: 'STATIC', ipAddress: '192.0.2.23', macAddress: 'AA:BB:CC:DD:EE:23' });
  await profile(ap, { addressMode: 'DHCP', ipAddress: null, macAddress: 'AA:BB:CC:DD:EE:24' });

  const taskDefinitions = TASK_SPECS.map(spec => ({ ...spec,
    systemId: systems.find(item => item.code === spec.systemCode).id,
    areaId: areas.find(item => item.code === spec.areaCode).id,
  }));
  const tasks = await seedDemoTasks({ root, projectId: project.id, taskDefinitions,
    technicianId: technician.user.id, managerId: manager.user.id, asManager, asTechnician, created });

  const traceCodes = ['OUT-LOBBY', 'CAM-DIRECT', 'CAM-OUTLET', 'CAM-PANEL', 'OUT-PENDING'];
  const traces = {};
  for (const code of traceCodes) {
    const result = await asManager('GET', `${root}/connections/trace?deviceCode=${code}`);
    traces[code] = result.paths.map(item => ({ complete: item.complete, segments: item.segments.length }));
  }
  if (traces['OUT-LOBBY'][0]?.complete !== true || traces['CAM-DIRECT'][0]?.complete !== true ||
    traces['CAM-OUTLET'][0]?.complete !== true || traces['CAM-PANEL'][0]?.complete !== true ||
    traces['OUT-PENDING'][0]?.complete !== false) throw new Error('Demo trace verification failed.');
  const layouts = {};
  for (const spec of RACK_LAYOUT) {
    const layout = await asManager('GET', `${root}/racks/${fixtureDevices[spec.code].id}/layout`);
    layouts[spec.code] = {
      role: layout.rack.rackRole, capacityU: layout.rack.capacityU,
      positioned: layout.positioned.map(item => ({ code: item.code, startU: item.startU, heightU: item.heightU })),
      zeroU: layout.zeroU.map(item => item.code), unplaced: layout.unplaced.map(item => item.code),
    };
  }
  const counts = { areas: areas.length, systems: systems.length, devices: devices.length, ports: [...portCache.values()].reduce((n, rows) => n + rows.length, 0),
    connections: connections.length, profiles: 4, tasks: tasks.length };
  console.log(JSON.stringify({ projectCode: project.code, projectId: project.id, created, counts, layouts, traces }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, requireManagedProject, assertDeviceFixture, preflightExistingDevices, assertLayoutPreflight,
  preflightExistingDependents, assertTaskCheckpoint, seedDemoTasks, DEVICE_SPECS, RACK_LAYOUT, PLACEMENT, PROJECT_CODE, MARKER };
