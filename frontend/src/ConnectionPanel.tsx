import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { User } from './api/auth';
import { ApiError } from './api/client';
import ExportDownloadButton from './ExportDownloadButton';
import {
  createConnection, createPort, deleteConnection, deletePort, getNetworkProfile, listConnections,
  listPorts, putNetworkProfile, rewireConnection, traceConnection, updatePort,
} from './api/connections';
import type {
  ConnectionInput, ConnectionKind, ConnectionTrace, DevicePort, NetworkProfile, PhysicalConnection,
} from './api/connections';
import { listDevices } from './api/devices';
import type { ProjectDevice } from './api/devices';
import { allowedKinds, connectionFaceChoices, faceKey, hasDuplicateIpWarning, missingFaceLabel, networkProfilePayload, poeLabel, portPayload, supportsDevicePorts, vlanLabel } from './connection-form';
import { deviceLabels } from './device-form';
import type { FaceOption } from './connection-form';
import { invalidateTraceRequest, visibleTrace } from './trace-request';
import ListView from './ListView';
import { useDialogFocus } from './useDialogFocus';

interface Props { token: string; user: User; projectId: string; deviceRevision: number; onSignOut: () => void }
interface Snapshot { devices: ProjectDevice[]; ports: DevicePort[]; connections: PhysicalConnection[] }
type Dialog = { kind: 'port'; port?: DevicePort } | { kind: 'connection'; connection?: PhysicalConnection } |
  { kind: 'profile'; device: ProjectDevice; profile: NetworkProfile | null | undefined; loadError?: string };

const REFRESH_FAILED = 'Đã lưu trên server nhưng chưa tải lại được, hãy tải lại trang.';
const sideLabel = { FRONT: 'Trước', REAR: 'Sau', SINGLE: 'Đơn' } as const;
const typeLabel = deviceLabels;
const kindLabel = { FIXED: 'Dây cố định', PATCH: 'Dây nhảy' } as const;

function messageOf(error: unknown): string {
  if (error instanceof ApiError && [400, 404, 409].includes(error.status)) return `Lỗi ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : 'Không thực hiện được. Hãy thử lại.';
}

function Modal({ title, busy, error, onClose, children }: { title: string; busy: boolean; error: string; onClose: () => void; children: ReactNode }) {
  const ref = useDialogFocus(title);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, onClose]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={ref} tabIndex={-1} className="modal connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title">
      <div className="modal-heading"><h2 id="connection-dialog-title">{title}</h2><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Đóng">×</button></div>
      {error && <div className="error-note modal-error" role="alert">{error}</div>}
      {children}
    </section>
  </div>;
}

function PortForm({ devices, ports, initial, busy, onCancel, onSave }: {
  devices: ProjectDevice[]; ports: DevicePort[]; initial?: DevicePort; busy: boolean;
  onCancel: () => void; onSave: (deviceId: string, body: ReturnType<typeof portPayload>) => void;
}) {
  const eligible = devices.filter(device => supportsDevicePorts(device.type) &&
    (!['CAMERA', 'AP'].includes(device.type) || Boolean(initial) || !ports.some(port => port.deviceId === device.id)));
  const [deviceId, setDeviceId] = useState(initial?.deviceId ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [vlan, setVlan] = useState(initial?.accessVlanId === null || initial?.accessVlanId === undefined ? '' : String(initial.accessVlanId));
  const [poe, setPoe] = useState(initial?.poeEnabled === null || initial?.poeEnabled === undefined ? '' : String(initial.poeEnabled));
  const [fieldError, setFieldError] = useState('');
  const device = devices.find(item => item.id === deviceId);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!device) { setFieldError('Chọn thiết bị trước khi lưu cổng.'); return; }
    try { onSave(device.id, portPayload(code, description, device.type === 'SWITCH', vlan, poe)); setFieldError(''); }
    catch (cause) { setFieldError(messageOf(cause)); }
  }
  return <form className="form-stack connection-form" onSubmit={submit}>
    <fieldset disabled={busy}>
      <label>Thiết bị<select aria-label="Thiết bị của cổng" value={deviceId} disabled={Boolean(initial)} required onChange={event => setDeviceId(event.target.value)}>
        <option value="">Chọn thiết bị</option>{eligible.map(item => <option key={item.id} value={item.id}>{item.code} — {typeLabel[item.type]}</option>)}
      </select></label>
      <div className="form-grid"><label>Mã cổng<input required value={code} onChange={event => setCode(event.target.value)} placeholder="P01 hoặc ETH1" /></label>
        <label>Mô tả<input value={description} onChange={event => setDescription(event.target.value)} placeholder="Tên vật lý, ví dụ Gi1/0/1" /></label></div>
      {device?.type === 'SWITCH' && <div className="form-grid"><label>VLAN access<input type="number" min="1" max="4094" step="1" value={vlan} onChange={event => setVlan(event.target.value)} placeholder="Để trống nếu chưa biết" /></label>
        <label>PoE<select aria-label="PoE" value={poe} onChange={event => setPoe(event.target.value)}><option value="">Chưa biết</option><option value="true">Bật</option><option value="false">Tắt</option></select></label></div>}
      {device && ['CAMERA', 'AP'].includes(device.type) && <p className="device-hint">Camera/AP chỉ có một cổng.</p>}
    </fieldset>
    {fieldError && <div className="error-note" role="alert">{fieldError}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Hủy</button><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : initial ? 'Lưu cổng' : 'Tạo cổng'}</button></div>
  </form>;
}

function ConnectionForm({ devices, ports, initial, busy, onCancel, onSave }: {
  devices: ProjectDevice[]; ports: DevicePort[]; initial?: PhysicalConnection; busy: boolean;
  onCancel: () => void; onSave: (body: ConnectionInput) => void;
}) {
  const { faces, firstOptions } = useMemo(() => connectionFaceChoices(devices, ports, initial?.id), [devices, ports, initial?.id]);
  const [aKey, setAKey] = useState(initial ? faceKey(initial.a.portId, initial.a.side) : '');
  const [bKey, setBKey] = useState(initial ? faceKey(initial.b.portId, initial.b.side) : '');
  const [kind, setKind] = useState<ConnectionKind>(initial?.kind ?? 'PATCH');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [fieldError, setFieldError] = useState('');
  const a = faces.find(face => face.key === aKey);
  const bOptions = a ? faces.filter(face => allowedKinds(a, face).length > 0) : [];
  const b = bOptions.find(face => face.key === bKey);
  const kinds = a && b ? allowedKinds(a, b) : [];
  const labelOf = (face: FaceOption) => `${face.device.code} / ${face.port.code} / ${sideLabel[face.side]}`;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!a || !b || !kinds.includes(kind)) { setFieldError('Chọn hai mặt cổng trống và loại dây hợp lệ.'); return; }
    onSave({ kind, a: { portId: a.port.id, side: a.side }, b: { portId: b.port.id, side: b.side },
      ...(initial ? {} : { label: label.trim() || null, description: description.trim() || null }) });
  }
  return <form className="form-stack connection-form" onSubmit={submit}>
    <fieldset disabled={busy}>
      <p className="device-hint">Chỉ hiện cặp mặt cổng hợp lệ. Cổng đã nối dây khác không thể chọn; server vẫn kiểm tra lại khi lưu.</p>
      <label>Đầu A<select aria-label="Đầu A" required value={aKey} onChange={event => { setAKey(event.target.value); setBKey(''); setKind('PATCH'); }}>
        <option value="">Chọn mặt cổng</option>{firstOptions.map(face => <option key={face.key} value={face.key}>{labelOf(face)}</option>)}
      </select></label>
      <label>Đầu B<select aria-label="Đầu B" required value={bKey} disabled={!a} onChange={event => {
        const selected = bOptions.find(face => face.key === event.target.value);
        setBKey(event.target.value); if (a && selected) setKind(allowedKinds(a, selected)[0]);
      }}><option value="">Chọn mặt cổng phù hợp</option>{bOptions.map(face => <option key={face.key} value={face.key}>{labelOf(face)}</option>)}</select></label>
      <label>Loại dây<select aria-label="Loại dây" value={kinds.includes(kind) ? kind : kinds[0] ?? ''} disabled={!b} onChange={event => setKind(event.target.value as ConnectionKind)}>
        {!kinds.length && <option value="">Chọn hai đầu trước</option>}{kinds.map(value => <option key={value} value={value}>{kindLabel[value]}</option>)}
      </select></label>
      {!initial && <><label>Nhãn dây<input value={label} onChange={event => setLabel(event.target.value)} placeholder="Không bắt buộc" /></label>
        <label>Mô tả<textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} /></label></>}
      {initial && <p className="device-hint">Phiên bản đang sửa: {initial.version}. Nếu dây đã thay đổi, server trả 409 và tải lại danh sách.</p>}
    </fieldset>
    {fieldError && <div className="error-note" role="alert">{fieldError}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Hủy</button><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : initial ? 'Chuyển dây' : 'Tạo kết nối'}</button></div>
  </form>;
}

function ProfileForm({ device, profile, busy, onCancel, onSave }: {
  device: ProjectDevice; profile: NetworkProfile | null; busy: boolean; onCancel: () => void;
  onSave: (value: ReturnType<typeof networkProfilePayload>) => void;
}) {
  const [mode, setMode] = useState(profile?.addressMode ?? '');
  const [ip, setIp] = useState(profile?.ipAddress ?? '');
  const [mac, setMac] = useState(profile?.macAddress ?? '');
  const [fieldError, setFieldError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { onSave(networkProfilePayload(mode, ip, mac)); setFieldError(''); }
    catch (cause) { setFieldError(messageOf(cause)); }
  }
  return <form className="form-stack connection-form" onSubmit={submit}>
    <p className="device-hint">{device.code}: hồ sơ nhập tay, không chứa mật khẩu và không xác nhận thiết bị đang online.</p>
    <fieldset disabled={busy}>
      <label>Cách cấp IP<select aria-label="Cách cấp IP" value={mode} onChange={event => setMode(event.target.value)}>
        <option value="">Chưa xác định</option><option value="STATIC">STATIC</option><option value="DHCP">DHCP</option>
      </select></label>
      <div className="form-grid"><label>IPv4<input value={ip} onChange={event => setIp(event.target.value)} placeholder="Có thể để trống" inputMode="decimal" /></label>
        <label>MAC<input value={mac} onChange={event => setMac(event.target.value)} placeholder="AA:BB:CC:DD:EE:FF" /></label></div>
    </fieldset>
    {fieldError && <div className="error-note" role="alert">{fieldError}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Hủy</button><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu hồ sơ mạng'}</button></div>
  </form>;
}

export default function ConnectionPanel({ token, user, projectId, deviceRevision, onSignOut }: Props) {
  const manager = user.role === 'MANAGER';
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [modalError, setModalError] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [query, setQuery] = useState('');
  const [trace, setTrace] = useState<{ revision: number; value: ConnectionTrace } | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState('');
  const [traceOpen, setTraceOpen] = useState(false);
  const request = useRef(0);
  const traceRequest = useRef(0);
  const writing = useRef(false);

  const reload = useCallback(async (failureMessage?: string): Promise<boolean> => {
    const current = ++request.current;
    invalidateTraceRequest(traceRequest);
    setTrace(null); setTraceError(''); setTraceLoading(false);
    setLoading(true); setSnapshot(null); setError(''); setNotice('');
    try {
      const devices = await listDevices(token, projectId);
      const portLists = await Promise.all(devices.filter(device => supportsDevicePorts(device.type)).map(device => listPorts(token, projectId, device.id)));
      const connections = await listConnections(token, projectId);
      if (current === request.current) { setSnapshot({ devices, ports: portLists.flat(), connections }); setRefreshFailed(false); }
      return current === request.current;
    } catch (cause) {
      if (current === request.current) { setError(failureMessage ?? messageOf(cause)); setRefreshFailed(true); }
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
      return false;
    } finally { if (current === request.current) setLoading(false); }
  }, [token, projectId, onSignOut]);
  useEffect(() => { void reload(); return () => { request.current++; traceRequest.current++; }; }, [reload, deviceRevision]);

  async function runWrite(action: () => Promise<unknown>, success: string) {
    if (!manager || writing.current || loading || refreshFailed) return;
    writing.current = true; setBusy(true); setModalError(''); setError(''); setNotice('');
    let result: unknown;
    try { result = await action(); }
    catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setDialog(null); setTrace(null); setTraceLoading(false); ++traceRequest.current;
        if (await reload('Dữ liệu đã đổi hoặc mặt cổng đã bận (409), nhưng chưa tải lại được. Hãy thử tải lại.')) {
          setError('Dữ liệu đã đổi hoặc mặt cổng đã bận (409). Danh sách đã được tải lại; hãy kiểm tra rồi thao tác lại.');
        }
      } else {
        setModalError(messageOf(cause));
        if (!dialog) setError(messageOf(cause));
      }
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
      setBusy(false); writing.current = false; return;
    }
    // Close before GET so a saved POST cannot be sent again while the list is stale.
    setDialog(null); setTrace(null); setTraceLoading(false); ++traceRequest.current;
    if (await reload(REFRESH_FAILED)) {
      const warnings = (result as NetworkProfile | undefined)?.warnings;
      setNotice(hasDuplicateIpWarning(warnings) ? `${success} Cảnh báo: IP này đã được nhập cho thiết bị khác trong công trình.` : success);
    }
    setBusy(false); writing.current = false;
  }

  async function loadProfile(device: ProjectDevice) {
    if (loading || refreshFailed || busy) return;
    setModalError(''); setDialog({ kind: 'profile', device, profile: undefined });
    try {
      const profile = await getNetworkProfile(token, projectId, device.id);
      setDialog(current => current?.kind === 'profile' && current.device.id === device.id ? { kind: 'profile', device, profile } : current);
    } catch (cause) {
      setDialog(current => current?.kind === 'profile' && current.device.id === device.id ? { kind: 'profile', device, profile: undefined, loadError: messageOf(cause) } : current);
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
    }
  }

  async function findTrace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = query.trim().toUpperCase();
    const current = ++traceRequest.current;
    setTrace(null); setTraceError(''); setTraceLoading(true);
    try { const result = await traceConnection(token, projectId, code); if (current === traceRequest.current) { setTrace({ revision: deviceRevision, value: result }); setTraceOpen(true); } }
    catch (cause) {
      if (current === traceRequest.current) setTraceError(messageOf(cause));
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
    } finally { if (current === traceRequest.current) setTraceLoading(false); }
  }

  const devices = snapshot?.devices ?? [];
  const activeTrace = visibleTrace(trace, deviceRevision);
  const ports = snapshot?.ports ?? [];
  const connections = snapshot?.connections ?? [];
  const canConnect = connectionFaceChoices(devices, ports).firstOptions.length > 0;
  const traceable = devices.filter(device => ['NETWORK_OUTLET', 'CAMERA', 'AP'].includes(device.type));
  const portDevices = devices.filter(device => supportsDevicePorts(device.type));
  const selectedDevice = portDevices.find(device => device.id === selectedDeviceId) ?? portDevices[0];
  const selectedPorts = selectedDevice ? ports.filter(port => port.deviceId === selectedDevice.id) : [];
  const canCreatePort = manager && selectedDevice !== undefined && (!['CAMERA', 'AP'].includes(selectedDevice.type) || selectedPorts.length === 0);
  const activeDialog = dialog && snapshot ? dialog : null;
  const close = () => { if (!writing.current) { setDialog(null); setModalError(''); } };
  const faceText = (endpoint: PhysicalConnection['a']) => `${endpoint.device.code} / ${endpoint.port.code} / ${sideLabel[endpoint.side]}${endpoint.device.rack ? ` · rack ${endpoint.device.rack.code}` : ''}`;

  return <section className="connections-panel" aria-busy={busy || loading} aria-label="Cổng và kết nối">
    <div className="panel-heading connection-heading export-panel-heading"><div><h3>Cổng và kết nối</h3><p className="device-caption">Tra đường dây theo mã nhãn, rồi kiểm tra từng mặt cổng</p>{manager&&<p className="export-context">Excel phản ánh cổng, dây và đoạn thiếu hiện tại; không phải snapshot nghiệm thu.</p>}</div>
      {manager&&<div className="export-heading-actions"><ExportDownloadButton token={token} projectId={projectId} kind="connections" label="Xuất Excel đấu nối" onSignOut={onSignOut}/></div>}</div>
    {!manager && <p className="device-caption">Hồ sơ chỉ đọc. Kỹ thuật viên có thể tra cứu đường dây và cấu hình đã khai báo.</p>}
    {notice && <div className={notice.includes('Cảnh báo:') ? 'connection-warning' : 'success-note'} role="status">{notice}</div>}
    {error && <div className="error-note" role="alert">{error}{refreshFailed && <button className="retry-inline" onClick={() => void reload()}>Tải lại kết nối</button>}</div>}
    {loading ? <div className="device-loading" role="status"><span className="spinner" />Đang tải cổng và kết nối…</div> : refreshFailed ?
      <p className="device-caption">Dữ liệu cũ đã được ẩn để tránh thao tác lặp. Chỉ cần tải lại bằng GET; không gửi lại thao tác lưu.</p> : snapshot && <>
        <div className="connection-trace-box">
          <div className="connection-section-title"><h4>Tra đường đi</h4><span>Từ ổ mạng, camera hoặc AP</span></div>
          <form className="connection-search" onSubmit={event => void findTrace(event)}>
            <label>Mã nhãn thiết bị<input aria-label="Mã tra cứu" list={`trace-codes-${projectId}`} value={query} onChange={event => setQuery(event.target.value)} required placeholder="Ví dụ CAM-01" /></label>
            <datalist id={`trace-codes-${projectId}`}>{traceable.map(device => <option key={device.id} value={device.code} />)}</datalist>
            <button className="button" disabled={traceLoading}>{traceLoading ? 'Đang tra…' : 'Tra đường đi'}</button>
          </form>
          {traceError && <div className="error-note" role="alert">{traceError}</div>}
          {activeTrace && traceOpen && <Modal title="Chi tiết đường dây" busy={false} error="" onClose={() => setTraceOpen(false)}><div className="trace-result">
            <div className="trace-origin"><strong>{activeTrace.device.code} — {activeTrace.device.name}</strong><span>{typeLabel[activeTrace.device.type]}</span>
              <small>Vị trí: {activeTrace.area ? `${activeTrace.area.code} — ${activeTrace.area.name}` : 'Chưa xác định khu vực'}{activeTrace.device.rack ? ` · Rack ${activeTrace.device.rack.code}` : ''}</small></div>
            {activeTrace.device.type !== 'NETWORK_OUTLET' && <div className="trace-network"><span>IP: {activeTrace.networkProfile?.ipAddress ?? 'Chưa cấp'}</span><span>Chế độ: {activeTrace.networkProfile?.addressMode ?? 'Chưa biết'}</span><span>MAC: {activeTrace.networkProfile?.macAddress ?? 'Chưa nhập'}</span></div>}
            {activeTrace.paths.length === 0 ? <p className="device-caption">Thiết bị chưa có cổng; chưa thể khai báo đường dây.</p> : activeTrace.paths.map(path => <div className="trace-path" key={path.port.id}>
              <strong>Cổng {path.port.code}</strong>
              {path.segments.map((segment, index) => <div className="trace-segment" key={segment.connectionId}><span>{index + 1}</span><div><b>{faceText(segment.from)}</b><small>{kindLabel[segment.kind]}</small><b>{faceText(segment.to)}</b></div></div>)}
              {path.complete && path.switchPort ? <div className="trace-complete">Đủ hồ sơ đường dây tới switch · VLAN {vlanLabel(path.switchPort.accessVlanId)} · PoE {poeLabel(path.switchPort.poeEnabled)}<small>Chưa xác nhận thiết bị online hoặc cấu hình thực tế.</small></div> :
                <div className="trace-missing">Thiếu đoạn từ {missingFaceLabel(path.missing, devices, ports)}. Chưa tới switch.</div>}
            </div>)}
          </div></Modal>}
        </div>

        <div className="connection-register">
          <div className="connection-section-title"><h4>Cổng thiết bị</h4>{manager && <button className="button button-small" disabled={!canCreatePort || busy} onClick={() => { setDialog({ kind: 'port' }); setModalError(''); }}>＋ Cổng</button>}</div>
          {portDevices.length === 0 ? <div className="empty-panel"><h4>Chưa có thiết bị có cổng</h4><p>Thêm outlet, panel, switch, camera hoặc AP trong danh mục thiết bị.</p></div> : <>
            <label className="connection-device-picker">Thiết bị<select aria-label="Xem cổng thiết bị" value={selectedDevice?.id ?? ''} onChange={event => setSelectedDeviceId(event.target.value)}>{portDevices.map(device => <option key={device.id} value={device.id}>{device.code} — {typeLabel[device.type]}</option>)}</select></label>
            {selectedDevice && ['CAMERA', 'AP'].includes(selectedDevice.type) && selectedPorts.length > 0 && <p className="device-hint">Camera/AP đã có một cổng; không thể tạo thêm.</p>}
            {selectedPorts.length === 0 ? <div className="empty-panel"><h4>Chưa có cổng</h4><p>{manager ? 'Tạo cổng để khai báo dây nối.' : 'Quản lý chưa khai báo cổng của thiết bị này.'}</p></div> :
              <ListView key={selectedDevice?.id} preferenceKey={selectedDevice?.id} rows={selectedPorts} label="cổng" className="connection-port-list" text={p => `${p.code} ${p.description ?? ''}`} kind={p => p.sides.some(s => s.connectionId) ? 'Đã nối' : 'Trống'}>{port => <li key={port.id} className="connection-port-row">
                <div><strong className="device-label">{port.code}</strong>{port.description && <small>{port.description}</small>}
                  {selectedDevice?.type === 'SWITCH' && <small>VLAN {vlanLabel(port.accessVlanId)} · PoE {poeLabel(port.poeEnabled)}</small>}</div>
                <div className="connection-faces">{port.sides.map(face => <span key={face.side} className={face.connectionId ? 'face-occupied' : 'face-free'}>{sideLabel[face.side]}: {face.connectionId ? 'Đã nối' : 'Trống'}</span>)}</div>
                {manager && <div className="device-actions"><button className="text-button" disabled={busy} onClick={() => { setDialog({ kind: 'port', port }); setModalError(''); }}>Sửa</button>
                  <button className="text-button device-delete" disabled={busy} onClick={() => { if (window.confirm(`Xóa cổng ${selectedDevice?.code} / ${port.code}? Cổng còn dây sẽ bị từ chối.`)) void runWrite(() => deletePort(token, projectId, port.deviceId, port.id), 'Đã xóa cổng.'); }}>Xóa</button></div>}
              </li>}</ListView>}
          </>}
        </div>

        <div className="connection-register">
          <div className="connection-section-title"><h4>Dây đã khai báo</h4>{manager && <button className="button button-small" disabled={busy || !canConnect} onClick={() => { setDialog({ kind: 'connection' }); setModalError(''); }}>＋ Kết nối</button>}</div>
          {connections.length === 0 ? <div className="empty-panel"><h4>Chưa có kết nối</h4><p>{manager ? 'Chọn hai mặt cổng để khai báo dây cố định hoặc dây nhảy.' : 'Đường dây sẽ xuất hiện khi quản lý bổ sung.'}</p></div> :
            <ListView rows={connections} label="kết nối" className="connection-wire-list" text={c => `${c.label ?? ''} ${faceText(c.a)} ${faceText(c.b)}`} kind={c => kindLabel[c.kind]}>{connection => <li key={connection.id} className="connection-wire-row">
              <div><strong>{connection.label || kindLabel[connection.kind]}</strong><small>{kindLabel[connection.kind]} · Phiên bản {connection.version}</small>{connection.description && <small>{connection.description}</small>}</div>
              <div className="connection-wire-ends"><span>{faceText(connection.a)}</span><span aria-hidden="true">──</span><span>{faceText(connection.b)}</span></div>
              {manager && <div className="device-actions"><button className="text-button" disabled={busy} onClick={() => { setDialog({ kind: 'connection', connection }); setModalError(''); }}>Chuyển dây</button>
                <button className="text-button device-delete" disabled={busy} onClick={() => { if (window.confirm(`Ngắt kết nối giữa ${faceText(connection.a)} và ${faceText(connection.b)}?`)) void runWrite(() => deleteConnection(token, projectId, connection.id), 'Đã ngắt kết nối.'); }}>Ngắt dây</button></div>}
            </li>}</ListView>}
        </div>

        <div className="connection-register">
          <div className="connection-section-title"><h4>Hồ sơ mạng camera / AP</h4><span>IP và MAC nhập tay</span></div>
          {traceable.filter(device => device.type !== 'NETWORK_OUTLET').length === 0 ? <p className="device-caption">Chưa có camera hoặc AP.</p> :
            <ListView rows={traceable.filter(device => device.type !== 'NETWORK_OUTLET')} label="hồ sơ mạng" className="connection-profile-list" text={d => `${d.code} ${d.name}`} kind={d => typeLabel[d.type]}>{device => <li key={device.id}><strong>{device.code}</strong><span>{typeLabel[device.type]}</span><button className="text-button" disabled={busy} onClick={() => void loadProfile(device)}>{manager ? 'Xem / sửa hồ sơ' : 'Xem hồ sơ'}</button></li>}</ListView>}
        </div>
      </>}

    {activeDialog && <Modal title={activeDialog.kind === 'port' ? activeDialog.port ? 'Sửa cổng' : 'Tạo cổng' : activeDialog.kind === 'connection' ? activeDialog.connection ? 'Chuyển dây' : 'Tạo kết nối' : `Hồ sơ mạng ${activeDialog.device.code}`}
      busy={busy} error={modalError} onClose={close}>
      {activeDialog.kind === 'port' && <PortForm devices={devices} ports={ports} initial={activeDialog.port} busy={busy} onCancel={close}
        onSave={(deviceId, body) => void runWrite(() => activeDialog.port ? updatePort(token, projectId, deviceId, activeDialog.port.id, body) : createPort(token, projectId, deviceId, body), activeDialog.port ? 'Đã lưu cổng.' : 'Đã tạo cổng.')} />}
      {activeDialog.kind === 'connection' && <ConnectionForm devices={devices} ports={ports} initial={activeDialog.connection} busy={busy} onCancel={close}
        onSave={body => void runWrite(() => activeDialog.connection ? rewireConnection(token, projectId, activeDialog.connection.id,
          { kind: body.kind, a: body.a, b: body.b, expectedVersion: activeDialog.connection.version }) : createConnection(token, projectId, body), activeDialog.connection ? 'Đã chuyển dây.' : 'Đã tạo kết nối.')} />}
      {activeDialog.kind === 'profile' && (activeDialog.profile === undefined ? <div className="device-loading" role="status">{activeDialog.loadError ? <div className="error-note" role="alert">{activeDialog.loadError}<button className="retry-inline" onClick={() => void loadProfile(activeDialog.device)}>Thử lại</button></div> : 'Đang tải hồ sơ mạng…'}</div> : <>
        {hasDuplicateIpWarning(activeDialog.profile?.warnings) && <div className="connection-warning" role="status">Cảnh báo: IP này đã được nhập cho thiết bị khác trong công trình.</div>}
        {manager ? <ProfileForm device={activeDialog.device} profile={activeDialog.profile} busy={busy} onCancel={close}
          onSave={body => void runWrite(() => putNetworkProfile(token, projectId, activeDialog.device.id, body), 'Đã lưu hồ sơ mạng.')} /> :
          <dl className="connection-profile-read"><dt>Cách cấp IP</dt><dd>{activeDialog.profile?.addressMode ?? 'Chưa biết'}</dd><dt>IPv4</dt><dd>{activeDialog.profile?.ipAddress ?? 'Chưa cấp'}</dd><dt>MAC</dt><dd>{activeDialog.profile?.macAddress ?? 'Chưa nhập'}</dd></dl>}
      </>)}
    </Modal>}
  </section>;
}
