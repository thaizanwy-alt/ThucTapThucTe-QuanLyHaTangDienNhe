// Local, API-only demo fixture. Run after migrations and the two account seed.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const PROJECT_CODE = 'CT-DEMO-ELV-01';
const MARKER = 'DEMO_SEED:ELV-BUILDING-V1 (fictional training data)';
const DEVICE_DESCRIPTION = 'Thiết bị demo — không đại diện hiện trạng thực';
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

function requireManagedProject(project) {
  if (project.description !== MARKER) {
    throw new Error(`${PROJECT_CODE} already exists but is not managed by this demo seed; no data was changed.`);
  }
  if (project.status !== 'IN_PROGRESS') throw new Error('Demo project status was changed; refusing to overwrite it.');
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
  const created = { project: 0, areas: 0, systems: 0, devices: 0, ports: 0, connections: 0, profiles: 0, tasks: 0 };

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
  preflightExistingDevices(DEVICE_SPECS, areas, systems, devices);
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

  const tasks = await asManager('GET', `${root}/tasks`);
  const taskDefinitions = [
    { code: 'TASK-LAN-ASSIGNED', title: 'Gắn nhãn ổ mạng sảnh', systemId: lan.id, areaId: lobby.id, status: 'ASSIGNED' },
    { code: 'TASK-WIFI-STARTED', title: 'Lắp AP tầng 2', systemId: wifi.id, areaId: office.id, status: 'IN_PROGRESS' },
    { code: 'TASK-CAM-SUBMITTED', title: 'Kiểm tra camera sảnh', systemId: camera.id, areaId: lobby.id, status: 'SUBMITTED' },
    { code: 'TASK-CAM-RETURNED', title: 'Khắc phục nhãn camera tầng 2', systemId: camera.id, areaId: office.id, status: 'RETURNED' },
    { code: 'TASK-LAN-APPROVED', title: 'Đấu dây mạng lễ tân', systemId: lan.id, areaId: lobby.id, status: 'APPROVED' },
  ];
  for (const spec of taskDefinitions) {
    let item = tasks.find(value => value.code === spec.code);
    if (item) {
      sameProject(item);
      if (item.title !== spec.title || item.assigneeId !== technician.user.id || item.systemId !== spec.systemId || item.areaId !== spec.areaId) {
        throw new Error(`Task ${spec.code} was changed; refusing to reuse it.`);
      }
    } else {
      item = await asManager('POST', `${root}/tasks`, {
        code: spec.code, title: spec.title, systemId: spec.systemId, areaId: spec.areaId,
        assigneeId: technician.user.id, description: 'Công việc demo — giả định quy trình thi công',
      });
      tasks.push(item);
      created.tasks++;
    }
    const route = `${root}/tasks/${item.id}`;
    if (item.status === 'ASSIGNED' && spec.status !== 'ASSIGNED') item = await asTechnician('POST', `${route}/start`);
    if (item.status === 'IN_PROGRESS' && !['ASSIGNED', 'IN_PROGRESS'].includes(spec.status)) {
      item = await asTechnician('POST', `${route}/submit`, { completionNote: 'Đã kiểm tra theo checklist demo; chờ quản lý xác nhận.' });
    }
    if (item.status === 'SUBMITTED' && spec.status === 'RETURNED') {
      item = await asManager('POST', `${route}/return`, { reason: 'Nhãn vị trí chưa khớp hồ sơ demo; cần kiểm tra lại.' });
    }
    if (item.status === 'SUBMITTED' && spec.status === 'APPROVED') item = await asManager('POST', `${route}/approve`);
    if (item.status !== spec.status) throw new Error(`Task ${spec.code} has unexpected status ${item.status}; refusing to change it further.`);
  }

  const traceCodes = ['OUT-LOBBY', 'CAM-DIRECT', 'CAM-OUTLET', 'CAM-PANEL', 'OUT-PENDING'];
  const traces = {};
  for (const code of traceCodes) {
    const result = await asManager('GET', `${root}/connections/trace?deviceCode=${code}`);
    traces[code] = result.paths.map(item => ({ complete: item.complete, segments: item.segments.length }));
  }
  if (traces['OUT-LOBBY'][0]?.complete !== true || traces['CAM-DIRECT'][0]?.complete !== true ||
    traces['CAM-OUTLET'][0]?.complete !== true || traces['CAM-PANEL'][0]?.complete !== true ||
    traces['OUT-PENDING'][0]?.complete !== false) throw new Error('Demo trace verification failed.');
  const counts = { areas: areas.length, systems: systems.length, devices: devices.length, ports: [...portCache.values()].reduce((n, rows) => n + rows.length, 0),
    connections: connections.length, profiles: 4, tasks: tasks.length };
  console.log(JSON.stringify({ projectCode: project.code, projectId: project.id, created, counts, traces }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main, requireManagedProject, assertDeviceFixture, preflightExistingDevices, DEVICE_SPECS, PROJECT_CODE, MARKER };
