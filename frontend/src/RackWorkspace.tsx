import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { User } from './api/auth';
import { ApiError } from './api/client';
import { listDevices } from './api/devices';
import type { ProjectDevice } from './api/devices';
import type { ProjectArea, ProjectSystem } from './api/projects';
import { getRackLayout, listRacks, putPlacement, updateRack } from './api/racks';
import type { PlacementInput, ProjectRack, RackDevice, RackInput, RackLayout } from './api/racks';
import { deviceLabels, isRackable } from './device-form';
import {
  elevationWindow, placementDraft, placementPayload, RackRequestGate, rackDraft, rackPayload,
  saveRackAndRefresh, visibleRackSnapshot,
} from './rack-form';
import type { PlacementDraft, RackDraft } from './rack-form';

interface Props {
  token: string; user: User; projectId: string; areas: ProjectArea[]; systems: ProjectSystem[];
  deviceRevision: number; expanded: boolean; onOpen: () => void; onBack: () => void; onSignOut: () => void;
}
interface Snapshot { scope: string; racks: ProjectRack[]; devices: ProjectDevice[]; layout: RackLayout | null }
type Drawer = { kind: 'rack'; rack: ProjectRack } | { kind: 'placement'; deviceId?: string } | { kind: 'device'; device: RackDevice };
const REFRESH_FAILED = 'Đã lưu trên server nhưng chưa tải lại được, hãy tải lại trang.';
const roleLabel = { MAIN: 'Tủ tổng', SUB: 'Tủ phụ' };
function messageOf(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.status === 409) return 'Lỗi 409: Ô U đang bận, dung lượng không phù hợp hoặc tủ còn phụ thuộc. Dữ liệu đã được tải lại; hãy kiểm tra trước khi thử tiếp.';
    if (cause.status === 404) return 'Lỗi 404: Tủ hoặc thiết bị không còn trong công trình. Hãy kiểm tra dữ liệu mới.';
    if (cause.status === 400) return 'Lỗi 400: Cấu hình tủ hoặc vị trí không hợp lệ. Kiểm tra nơi đặt, vai trò và khoảng U.';
  }
  return cause instanceof Error ? cause.message : 'Không tải được dữ liệu tủ.';
}
const rangeLabel = (device: RackDevice) => device.startU == null ? 'Chưa xếp' : `U${device.startU}–${device.startU + (device.heightU ?? 1) - 1}`;

function RackDrawer({ kind, title, busy, error, onClose, children }: { kind: Drawer['kind']; title: string; busy: boolean; error: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const field = ref.current?.querySelector<HTMLElement>('form input:not(:disabled), form select:not(:disabled), form textarea:not(:disabled)');
    const target = field ?? ref.current?.querySelector<HTMLElement>('#rack-drawer-title') ?? ref.current;
    target?.focus();
  }, [kind]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key !== 'Tab') return;
      const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
      if (!nodes?.length) { event.preventDefault(); ref.current?.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!ref.current?.contains(document.activeElement) || !Array.from(nodes).includes(document.activeElement as HTMLElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [busy, onClose]);
  return <div className="modal-backdrop rack-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={ref} tabIndex={-1} className="modal rack-drawer" role="dialog" aria-modal="true" aria-labelledby="rack-drawer-title">
      <div className="modal-heading"><h2 id="rack-drawer-title" tabIndex={-1}>{title}</h2><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Đóng">×</button></div>
      {error && <div className="error-note" role="alert">{error}</div>}{children}
    </section>
  </div>;
}

function RackForm({ rack, racks, areas, busy, onSave, onCancel }: {
  rack: ProjectRack; racks: ProjectRack[]; areas: ProjectArea[]; busy: boolean; onSave: (input: RackInput) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => rackDraft(rack));
  const [error, setError] = useState('');
  const set = <K extends keyof RackDraft>(key: K, value: RackDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    try { const input = rackPayload(draft, rack.id, racks); setError(''); onSave(input); }
    catch (cause) { setError(messageOf(cause)); }
  }
  return <form className="form-stack" onSubmit={submit}>
    <fieldset disabled={busy}><legend>{rack.code} · cấu hình quản lý</legend>
      <p className="form-hint">Tủ cha–con là phân cấp quản lý, không tạo dây uplink. Area phục vụ được chọn tường minh; chọn tầng không tự chọn phòng.</p>
      <label>Vai trò tủ<select aria-label="Vai trò tủ" value={draft.role} onChange={e => set('role', e.target.value)}><option value="">Chưa phân loại</option><option value="MAIN">MAIN · Tủ tổng</option><option value="SUB">SUB · Tủ phụ</option></select></label>
      {draft.role === 'SUB' && <label>Tủ MAIN quản lý<select aria-label="Tủ MAIN quản lý" required value={draft.parentId} onChange={e => set('parentId', e.target.value)}><option value="">Chọn tủ tổng</option>{racks.filter(r => r.rackRole === 'MAIN' && r.id !== rack.id).map(r => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}</select></label>}
      <div className="form-grid"><label>Nơi đặt<select aria-label="Nơi đặt" required={Boolean(draft.role)} value={draft.areaId} onChange={e => set('areaId', e.target.value)}><option value="">Chưa xác định</option>{areas.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>
        <label>Dung lượng (U)<input required={Boolean(draft.role)} type="number" min="1" max="2147483647" step="1" value={draft.capacity} onChange={e => set('capacity', e.target.value)} /></label></div>
      <fieldset className="rack-area-choices"><legend>Area phục vụ</legend>{areas.length === 0 && <p>Chưa có tầng/phòng. Tạo Area ở tổng quan trước.</p>}{areas.map(a => <label key={a.id}><input type="checkbox" checked={draft.servedAreaIds.includes(a.id)} onChange={e => set('servedAreaIds', e.target.checked ? [...draft.servedAreaIds, a.id] : draft.servedAreaIds.filter(id => id !== a.id))} /><span>{a.code} — {a.name}<small>{a.type === 'FLOOR' ? 'Tầng' : 'Phòng'}</small></span></label>)}</fieldset>
    </fieldset>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Hủy</button><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu cấu hình'}</button></div>
  </form>;
}

function PlacementForm({ devices, racks, areas, selectedRackId, initialDeviceId, busy, onSave, onCancel }: {
  devices: ProjectDevice[]; racks: ProjectRack[]; areas: ProjectArea[]; selectedRackId: string; initialDeviceId?: string;
  busy: boolean; onSave: (deviceId: string, input: PlacementInput) => void; onCancel: () => void;
}) {
  const eligible = devices.filter(d => isRackable(d.type));
  const [deviceId, setDeviceId] = useState(initialDeviceId ?? eligible[0]?.id ?? '');
  const device = eligible.find(d => d.id === deviceId);
  const [draft, setDraft] = useState<PlacementDraft>(() => device ? placementDraft(device, selectedRackId) : { target: 'rack', rackId: selectedRackId, areaId: '', mode: '', start: '', height: '1' });
  const [error, setError] = useState('');
  const set = <K extends keyof PlacementDraft>(key: K, value: PlacementDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    try { if (!device) throw new Error('Chọn thiết bị cần bố trí.'); const input = placementPayload(draft, device, racks); setError(''); onSave(device.id, input); }
    catch (cause) { setError(messageOf(cause)); }
  }
  return <form className="form-stack" onSubmit={submit}>
    <fieldset disabled={busy}><legend>Bố trí thiết bị</legend>
      <label>Thiết bị<select aria-label="Thiết bị" required value={deviceId} onChange={e => { setDeviceId(e.target.value); const next = eligible.find(d => d.id === e.target.value); if (next) setDraft(placementDraft(next, selectedRackId)); setError(''); }}><option value="">Chọn thiết bị</option>{eligible.map(d => <option key={d.id} value={d.id}>{d.code} — {deviceLabels[d.type]}</option>)}</select></label>
      <label>Vị trí<select aria-label="Vị trí" value={draft.target} onChange={e => set('target', e.target.value as PlacementDraft['target'])}><option value="rack">Trong tủ rack</option><option value="area">Ngoài tủ · đặt tại Area</option><option value="none">Chưa ghi nhận vị trí</option></select></label>
      {draft.target === 'area' && <label>Area<select aria-label="Area" required value={draft.areaId} onChange={e => set('areaId', e.target.value)}><option value="">Chọn Area</option>{areas.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}</select></label>}
      {draft.target === 'rack' && <><label>Tủ rack<select aria-label="Tủ rack" required value={draft.rackId} onChange={e => set('rackId', e.target.value)}><option value="">Chọn tủ</option>{racks.map(r => <option key={r.id} value={r.id}>{r.code} · {r.capacityU ?? '?'}U</option>)}</select></label>
        <label>Kiểu lắp<select aria-label="Kiểu lắp" value={draft.mode} onChange={e => set('mode', e.target.value as PlacementDraft['mode'])}><option value="">Chưa xếp · bỏ vị trí U</option><option value="U">Lắp theo U</option>{device?.type === 'PDU' && <option value="ZERO_U">ZERO_U · PDU dọc</option>}</select></label>
        {draft.mode === 'U' && <div className="form-grid"><label>U bắt đầu<input type="number" min="1" max="2147483647" step="1" value={draft.start} onChange={e => set('start', e.target.value)} placeholder="Để trống: chưa xếp" /></label><label>Chiều cao (U)<input required type="number" min="1" max="2147483647" step="1" value={draft.height} onChange={e => set('height', e.target.value)} /></label></div>}
        <p className="form-hint">U1 ở đáy. Thiết bị chưa có U bắt đầu vẫn nằm trong “Chưa xếp”, không được vẽ như đã lắp. Khi chuyển tủ hoặc ra Area, vị trí cũ được xóa trong cùng PUT.</p>
      </>}
    </fieldset>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Hủy</button><button className="button" disabled={busy || !device}>{busy ? 'Đang lưu…' : 'Lưu vị trí'}</button></div>
  </form>;
}

function Elevation({ layout, onDevice }: { layout: RackLayout; onDevice: (device: RackDevice) => void }) {
  const [page, setPage] = useState(0);
  const capacity = layout.rack.capacityU ?? 0;
  const view = elevationWindow(capacity, page, layout.positioned);
  return <section className="rack-elevation-panel" aria-label="Sơ đồ mặt trước tủ">
    <div className="rack-elevation-heading"><h4>Mặt trước</h4><span>{layout.occupiedU}/{capacity || '?'} U đã xếp</span></div>
    {capacity === 0 ? <div className="empty-panel">Tủ chưa có dung lượng U. {layout.rack.rackRole === null && 'Tủ cũ vẫn có thể xem và cấu hình.'}</div> : <>
      {view.pages > 1 && <div className="rack-pages"><button className="text-button" disabled={view.current === 0} onClick={() => setPage(view.current - 1)}>↑ Phần trên</button><span>U{view.bottom}–U{view.top}</span><button className="text-button" disabled={view.current + 1 === view.pages} onClick={() => setPage(view.current + 1)}>Phần dưới ↓</button></div>}
      <div className="rack-elevation" style={{ gridTemplateRows: `repeat(${view.units.length}, 32px)` }}>
        {view.units.map((unit, index) => <span className="rack-unit-number" style={{ gridRow: index + 1 }} key={`label:${unit}`}>U{unit}</span>)}
        {view.units.filter(unit => !layout.positioned.some(d => d.startU != null && unit >= d.startU && unit < d.startU + (d.heightU ?? 0))).map(unit => <div className="rack-empty-unit" style={{ gridRow: view.top - unit + 1 }} key={`empty:${unit}`}><span>Trống</span></div>)}
        {view.placed.map(({ device, row, span }) => <button key={device.id} className={`rack-mounted rack-mounted-${device.type.toLowerCase()}`} style={{ gridRow: `${row} / span ${span}` }} onClick={() => onDevice(device)} aria-label={`${device.code}, ${device.name}, ${rangeLabel(device)}`}><strong>{device.code}</strong><span>{device.name}</span><small>{deviceLabels[device.type]} · {rangeLabel(device)}</small></button>)}
      </div><p className="rack-bottom-label">Đáy tủ · U1 ở dưới</p>
    </>}
  </section>;
}

export default function RackWorkspace({ token, user, projectId, areas, systems, deviceRevision, expanded, onOpen, onBack, onSignOut }: Props) {
  const manager = user.role === 'MANAGER';
  const [requestedRackId, setRequestedRackId] = useState('');
  const scope = JSON.stringify([projectId, deviceRevision, requestedRackId]);
  const gate = useRef(new RackRequestGate());
  gate.current.setScope(scope);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const data = visibleRackSnapshot(snapshot, scope);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [drawerError, setDrawerError] = useState('');
  const reload = useCallback(async (failureMessage?: string): Promise<boolean> => {
    const ticket = gate.current.begin();
    setSnapshot(null); setDrawer(null); setDrawerError(''); setLoading(true); setError(''); setNotice('');
    try {
      const [racks, devices] = await Promise.all([listRacks(token, projectId), listDevices(token, projectId)]);
      if (!gate.current.current(ticket)) return false;
      const selected = racks.find(r => r.id === requestedRackId) ?? racks.find(r => r.rackRole === 'MAIN') ?? racks[0];
      const layout = selected ? await getRackLayout(token, projectId, selected.id) : null;
      if (!gate.current.current(ticket)) return false;
      setSnapshot({ scope, racks, devices, layout });
      return true;
    } catch (cause) {
      if (gate.current.current(ticket)) { setError(failureMessage ?? messageOf(cause)); if (cause instanceof ApiError && cause.status === 401) onSignOut(); }
      return false;
    } finally { if (gate.current.current(ticket)) setLoading(false); }
  }, [token, projectId, requestedRackId, scope, onSignOut]);
  useEffect(() => { void reload(); return () => gate.current.invalidate(); }, [reload]);

  async function write(action: () => Promise<unknown>) {
    if (!manager || busy || !data) return;
    const ticket = gate.current.begin();
    setBusy(true); setDrawerError(''); setNotice(''); setError('');
    try {
      const refreshed = await saveRackAndRefresh(action, () => { if (gate.current.current(ticket)) setDrawer(null); },
        () => gate.current.current(ticket) ? reload(REFRESH_FAILED) : Promise.resolve(false));
      if (refreshed) setNotice('Đã lưu và tải lại sơ đồ tủ.');
    } catch (cause) {
      if (!gate.current.current(ticket)) return;
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
      if (cause instanceof ApiError && [404, 409].includes(cause.status)) {
        const reason = messageOf(cause); const refreshed = await reload();
        if (refreshed) setError(reason);
      } else setDrawerError(messageOf(cause));
    } finally { setBusy(false); }
  }
  const layout = data?.layout;
  const rack = layout?.rack;
  const areaName = (id: string | null) => areas.find(a => a.id === id)?.name ?? (id ? 'Area không còn trong danh sách' : 'Chưa xác định');
  const openDevice = (device: RackDevice) => { setDrawerError(''); setDrawer({ kind: 'device', device }); };
  const close = () => { if (!busy) { setDrawer(null); setDrawerError(''); } };
  const viewed = drawer?.kind === 'device' ? drawer.device : null;
  const fullDevice = viewed ? data?.devices.find(d => d.id === viewed.id) : null;
  const listGroup = (title: string, items: RackDevice[], hint: string) => <section className="rack-side-list"><div><h4>{title}<span>{items.length}</span></h4><p>{hint}</p></div>{items.length ? <ul>{items.map(d => <li key={d.id}><button onClick={() => openDevice(d)}><strong>{d.code}</strong><span>{d.name}</span><small>{deviceLabels[d.type]}{d.heightU ? ` · ${d.heightU}U` : ''}</small></button></li>)}</ul> : <p className="rack-list-empty">Không có thiết bị.</p>}</section>;

  return <section className={expanded ? 'rack-workspace' : 'rack-overview-card'} aria-label="Sơ đồ tủ">
    {!expanded ? <div className="rack-card-heading"><span className="rack-card-mark" aria-hidden="true">▤</span><div><span className="section-kicker">Bố trí thiết bị</span><h3>Sơ đồ tủ</h3><p>{data ? `${data.racks.length} tủ · ${data.racks.filter(r => r.rackRole === 'MAIN').length} MAIN · ${data.racks.filter(r => r.rackRole === 'SUB').length} SUB · ${data.racks.filter(r => !r.rackRole).length} chưa phân loại` : loading ? 'Đang tải hồ sơ tủ…' : 'Chưa tải được hồ sơ tủ'}</p></div><button className="button button-quiet" onClick={onOpen}>Mở sơ đồ tủ →</button></div> : <>
      <div className="rack-screen-heading"><div><button className="back-projects" onClick={onBack}>← Tổng quan công trình</button><h3>Sơ đồ tủ</h3><p>Phân cấp quản lý · không thể hiện dây uplink đã thi công</p></div><span className="role-chip">{manager ? 'Quản lý bố trí' : 'Chỉ xem'}</span></div>
      {data && data.racks.length === 0 && <div className="empty-panel"><h4>Chưa có tủ rack</h4><p>{manager ? 'Tạo thiết bị loại RACK tại mục Thiết bị trên tổng quan, rồi trở lại đây để cấu hình.' : 'Công trình chưa khai báo tủ rack.'}</p></div>}
      {data && layout && rack && <div className="rack-screen-grid">
        <aside className="rack-tree" aria-label="Phân cấp quản lý tủ"><h4>Tủ trong công trình</h4>
          {data.racks.filter(r => r.rackRole === 'MAIN').map(main => <div className="rack-tree-group" key={main.id}><button className={main.id === rack.id ? 'active' : ''} onClick={() => setRequestedRackId(main.id)}><small>MAIN</small><strong>{main.code}</strong><span>{main.name}</span></button><div className="rack-tree-children">{data.racks.filter(r => r.rackRole === 'SUB' && r.parentRackId === main.id).map(sub => <button key={sub.id} className={sub.id === rack.id ? 'active' : ''} onClick={() => setRequestedRackId(sub.id)}><small>SUB</small><strong>{sub.code}</strong><span>{sub.name}</span></button>)}</div></div>)}
          {data.racks.filter(r => !r.rackRole || (r.rackRole === 'SUB' && !data.racks.some(m => m.id === r.parentRackId && m.rackRole === 'MAIN'))).length > 0 && <div className="rack-unclassified"><h4>Tủ chưa phân loại / chưa gắn cây</h4>{data.racks.filter(r => !r.rackRole || (r.rackRole === 'SUB' && !data.racks.some(m => m.id === r.parentRackId && m.rackRole === 'MAIN'))).map(r => <button key={r.id} className={r.id === rack.id ? 'active' : ''} onClick={() => setRequestedRackId(r.id)}><strong>{r.code}</strong><span>{r.name}</span></button>)}</div>}
        </aside>
        <div className="rack-main-view"><label className="rack-mobile-picker">Chọn tủ<select aria-label="Chọn tủ" value={rack.id} onChange={e => setRequestedRackId(e.target.value)}>{data.racks.map(r => <option key={r.id} value={r.id}>{r.rackRole ?? 'Chưa phân loại'} · {r.code} · {r.capacityU ?? '?'}U</option>)}</select></label>
          <div className="rack-title"><div><span className="section-kicker">{rack.rackRole ? roleLabel[rack.rackRole] : 'Tủ chưa phân loại'} · {rack.capacityU ?? '?'}U</span><h4>{rack.code}</h4><p>{rack.name}</p></div>{manager && <div className="rack-actions"><button className="button button-small button-quiet" disabled={busy} onClick={() => { setDrawerError(''); setDrawer({ kind: 'rack', rack }); }}>Cấu hình tủ</button><button className="button button-small" disabled={busy} onClick={() => { setDrawerError(''); setDrawer({ kind: 'placement' }); }}>Xếp / chuyển thiết bị</button></div>}</div>
          <dl className="rack-location"><div><dt>Nơi đặt</dt><dd>{areaName(rack.areaId)}{rack.locationNote ? ` · ${rack.locationNote}` : ''}</dd></div><div><dt>Area phục vụ</dt><dd>{rack.servedAreaIds.length ? rack.servedAreaIds.map(id => <span key={id}>{areas.find(a => a.id === id)?.code ?? '?'} · {areaName(id)}</span>) : 'Chưa khai báo'}</dd></div></dl>
          <div className="rack-layout-columns"><Elevation key={rack.id} layout={layout} onDevice={openDevice} /><aside className="rack-accessories">{listGroup('Phụ kiện ZERO_U', layout.zeroU, 'PDU dọc · không chiếm ô U mặt trước')}{listGroup('Chưa xếp', layout.unplaced, 'Đã thuộc tủ, chưa có vị trí lắp U')}</aside></div>
        </div>
      </div>}
    </>}
    {loading && expanded && <div className="detail-loading" role="status"><span className="spinner" />Đang tải tủ và bố trí U…</div>}
    {error && <div className="error-note" role="alert">{error}<button className="text-button" disabled={loading || busy} onClick={() => void reload()}>Thử tải lại bằng GET</button></div>}
    {notice && <div className="success-note" role="status">{notice}</div>}
    {expanded && data && drawer && <RackDrawer kind={drawer.kind} title={drawer.kind === 'rack' ? 'Cấu hình tủ' : drawer.kind === 'placement' ? 'Xếp / chuyển thiết bị' : 'Chi tiết thiết bị'} busy={busy} error={drawerError} onClose={close}>
      {drawer.kind === 'rack' && manager && <RackForm rack={drawer.rack} racks={data.racks} areas={areas} busy={busy} onCancel={close} onSave={input => void write(() => updateRack(token, projectId, drawer.rack.id, input))} />}
      {drawer.kind === 'placement' && manager && <PlacementForm devices={data.devices} racks={data.racks} areas={areas} selectedRackId={rack?.id ?? ''} initialDeviceId={drawer.deviceId} busy={busy} onCancel={close} onSave={(id, input) => void write(() => putPlacement(token, projectId, id, input))} />}
      {viewed && <><div className="rack-device-title"><span className="section-kicker">{deviceLabels[viewed.type]}</span><h3>{viewed.code}</h3><p>{viewed.name}</p></div><dl className="device-detail-grid">
        <div><dt>Vị trí lắp</dt><dd>{viewed.mountMode === 'ZERO_U' ? 'ZERO_U · PDU dọc' : rangeLabel(viewed)}{viewed.heightU ? ` · ${viewed.heightU}U` : ''}</dd></div><div><dt>Tủ</dt><dd>{data.racks.find(r => r.id === viewed.rackId)?.code ?? 'Ngoài tủ'}</dd></div>
        <div><dt>Nơi đặt hiệu lực</dt><dd>{areaName(fullDevice?.effectiveAreaId ?? viewed.areaId)}</dd></div><div><dt>Hệ thống</dt><dd>{fullDevice?.systemIds.map(id => systems.find(s => s.id === id)?.name ?? 'Hệ thống không còn trong danh sách').join(', ') || 'Chưa liên kết'}</dd></div>
        {([['Hãng', viewed.brand], ['Model', viewed.model], ['Số serial', viewed.serialNumber], ['Ghi chú vị trí', viewed.locationNote], ['Mô tả', viewed.description]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Chưa ghi nhận'}</dd></div>)}
      </dl>{manager && <button className="button" onClick={() => setDrawer({ kind: 'placement', deviceId: viewed.id })}>Xếp / chuyển / bỏ vị trí U</button>}</>}
    </RackDrawer>}
  </section>;
}
