import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { User } from './api/auth';
import { ApiError } from './api/client';
import { createDevice, deleteDevice, listDevices, updateDevice } from './api/devices';
import type { DeviceInput, DeviceType, DeviceUpdate, ProjectDevice } from './api/devices';
import type { ProjectArea, ProjectSystem } from './api/projects';
import { deviceDraft, deviceLabels, devicePayload, isRackable } from './device-form';
import type { DeviceDraft } from './device-form';
import { saveDeviceAndNotify } from './device-refresh';
import ListView from './ListView';
import ExportDownloadButton from './ExportDownloadButton';

interface Props {
  token: string;
  user: User;
  projectId: string;
  areas: ProjectArea[];
  systems: ProjectSystem[];
  onSignOut: () => void;
  onDeviceChanged: () => void;
}

type Dialog = { kind: 'create' } | { kind: 'edit' | 'view' | 'delete'; device: ProjectDevice };
const REFRESH_FAILED = 'Đã lưu trên server nhưng chưa tải lại được, hãy tải lại trang.';

function messageOf(cause: unknown): string {
  if (cause instanceof ApiError && [400, 404, 409].includes(cause.status)) return `Lỗi ${cause.status}: ${cause.message}`;
  return cause instanceof Error ? cause.message : 'Không thực hiện được thao tác. Hãy thử lại.';
}

function DeviceDialog({ title, busy, error, onClose, children }: {
  title: string; busy: boolean; error: string; onClose: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => { previous?.focus(); };
  }, []);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key !== 'Tab') return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)');
      if (!elements?.length) { event.preventDefault(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [busy, onClose]);
  return <div className="modal-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !busy) onClose();
  }}>
    <section ref={dialog} tabIndex={-1} className="modal device-dialog" role="dialog" aria-modal="true" aria-labelledby="device-dialog-title">
      <div className="modal-heading"><h2 id="device-dialog-title">{title}</h2><button className="icon-button" type="button" disabled={busy} onClick={onClose} aria-label="Đóng">×</button></div>
      {error && <div className="error-note modal-error" role="alert">{error}</div>}
      {children}
    </section>
  </div>;
}

function DeviceForm({ initial, areas, systems, racks, busy, onCancel, onSave }: {
  initial?: ProjectDevice; areas: ProjectArea[]; systems: ProjectSystem[]; racks: ProjectDevice[];
  busy: boolean; onCancel: () => void; onSave: (input: DeviceInput | DeviceUpdate) => void;
}) {
  const [draft, setDraft] = useState(() => deviceDraft(initial));
  const [fieldError, setFieldError] = useState('');
  const set = <K extends keyof DeviceDraft>(key: K, value: DeviceDraft[K]) => setDraft(current => ({ ...current, [key]: value }));
  const canUseRack = isRackable(draft.type);
  function changeType(type: DeviceType) {
    setDraft(current => ({ ...current, type,
      capacityU: type === 'RACK' ? current.capacityU : '',
      placement: current.placement === 'rack' && !isRackable(type) ? 'none' : current.placement,
    }));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { const input = devicePayload(draft, Boolean(initial)); setFieldError(''); onSave(input); }
    catch (cause) { setFieldError(messageOf(cause)); }
  }
  return <form className="form-stack device-form" onSubmit={submit} aria-busy={busy}>
    <fieldset disabled={busy}>
      <legend>Thông tin thiết bị</legend>
      <label>Loại thiết bị<select aria-label="Loại thiết bị" value={draft.type} disabled={Boolean(initial)} onChange={event => changeType(event.target.value as DeviceType)}>
        {Object.entries(deviceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {initial && <p className="device-hint">Loại thiết bị không đổi sau khi tạo.</p>}
      <div className="form-grid">
        <label>Mã nhãn<input required value={draft.code} onChange={event => set('code', event.target.value)} placeholder="VD: RACK-01 hoặc SW-01" /></label>
        <label>Tên thiết bị<input required value={draft.name} onChange={event => set('name', event.target.value)} placeholder="Tên để nhận diện tại công trình" /></label>
      </div>
      <div className="form-grid">
        <label>Hãng<input value={draft.brand} onChange={event => set('brand', event.target.value)} /></label>
        <label>Model<input value={draft.model} onChange={event => set('model', event.target.value)} /></label>
      </div>
      <label>Số serial<input value={draft.serialNumber} onChange={event => set('serialNumber', event.target.value)} /></label>
      {draft.type === 'RACK' && <label>Dung lượng rack (U)<input type="number" min="1" max="2147483647" step="1" value={draft.capacityU} onChange={event => set('capacityU', event.target.value)} placeholder="Không bắt buộc, VD: 42" /></label>}
    </fieldset>
    <fieldset disabled={busy}>
      <legend>Vị trí lắp đặt</legend>
      <label>Cách đặt vị trí<select aria-label="Cách đặt vị trí" value={draft.placement} onChange={event => set('placement', event.target.value as DeviceDraft['placement'])}>
        <option value="none">Chưa xác định vị trí</option><option value="area">Tại tầng / phòng</option>
        {canUseRack && <option value="rack">Trong tủ rack</option>}
      </select></label>
      {draft.placement === 'area' && <label>Tầng / phòng<select aria-label="Tầng / phòng" required value={draft.areaId} onChange={event => set('areaId', event.target.value)}>
        <option value="">Chọn khu vực</option>
        {areas.map(area => <option key={area.id} value={area.id}>{area.code} — {area.name} ({area.type === 'FLOOR' ? 'tầng' : 'phòng'})</option>)}
      </select></label>}
      {draft.placement === 'rack' && <>
        <label>Tủ rack<select aria-label="Tủ rack" required value={draft.rackId} onChange={event => set('rackId', event.target.value)}>
          <option value="">Chọn rack trong công trình</option>
          {racks.map(rack => <option key={rack.id} value={rack.id}>{rack.code} — {rack.name}</option>)}
        </select></label>
        <p className="device-hint">Thiết bị kế thừa tầng/phòng của rack. Đổi rack sẽ thay vị trí cũ trong cùng lần lưu.</p>
        {racks.length === 0 && <p className="device-hint">Chưa có rack. Tạo tủ rack trước hoặc chọn vị trí trực tiếp.</p>}
      </>}
      {!canUseRack && <p className="device-hint">Loại thiết bị này đặt trực tiếp tại Area, không lắp trong rack; tủ rack không lồng nhau.</p>}
      <label>Ghi chú vị trí<textarea rows={2} value={draft.locationNote} onChange={event => set('locationNote', event.target.value)} placeholder="VD: sát cửa phòng kỹ thuật" /></label>
    </fieldset>
    <fieldset className="device-systems" disabled={busy}>
      <legend>Hệ thống liên quan</legend>
      <p className="device-hint">Có thể chọn nhiều hạng mục hoặc không chọn. Bỏ chọn tất cả sẽ xóa các liên kết cũ.</p>
      {systems.length === 0 ? <p className="device-hint">Công trình chưa có hạng mục hệ thống.</p> : systems.map(system => <label className="device-checkbox" key={system.id}>
        <input type="checkbox" checked={draft.systemIds.includes(system.id)} onChange={event => set('systemIds', event.target.checked ? [...draft.systemIds, system.id] : draft.systemIds.filter(id => id !== system.id))} />
        <span>{system.code} — {system.name}<small>{system.category}</small></span>
      </label>)}
    </fieldset>
    <fieldset disabled={busy}><legend>Mô tả</legend><label>Thông tin thêm<textarea rows={3} value={draft.description} onChange={event => set('description', event.target.value)} /></label></fieldset>
    {fieldError && <div className="error-note modal-error" role="alert">{fieldError}</div>}
    <div className="form-actions"><button type="button" className="button button-quiet" disabled={busy} onClick={onCancel}>Hủy</button><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : initial ? 'Lưu thiết bị' : 'Tạo thiết bị'}</button></div>
  </form>;
}

export default function DevicePanel({ token, user, projectId, areas, systems, onSignOut, onDeviceChanged }: Props) {
  const manager = user.role === 'MANAGER';
  const [devices, setDevices] = useState<ProjectDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [modalError, setModalError] = useState('');
  const request = useRef(0);
  const writing = useRef(false);

  const reload = useCallback(async (failureMessage?: string): Promise<boolean> => {
    const current = ++request.current;
    setLoading(true); setError(''); setNotice('');
    try {
      const rows = await listDevices(token, projectId);
      if (current === request.current) { setDevices(rows); setRefreshFailed(false); }
      return current === request.current;
    } catch (cause) {
      if (current === request.current) { setError(failureMessage ?? messageOf(cause)); setRefreshFailed(true); }
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
      return false;
    } finally { if (current === request.current) setLoading(false); }
  }, [token, projectId, onSignOut]);
  useEffect(() => { void reload(); return () => { request.current++; }; }, [reload]);

  async function runWrite(action: () => Promise<unknown>, success: string, deleting = false) {
    if (!manager || writing.current || loading || refreshFailed) return;
    writing.current = true;
    setBusy(true); setModalError(''); setError(''); setNotice('');
    try { await saveDeviceAndNotify(action, onDeviceChanged); }
    catch (cause) {
      setModalError(messageOf(cause));
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
      setBusy(false); writing.current = false; return;
    }
    // A successful write closes the form before GET: never offer to repeat a saved POST.
    setDialog(null);
    if (await reload(deleting ? 'Đã xóa trên server nhưng chưa tải lại được, hãy tải lại trang.' : REFRESH_FAILED)) setNotice(success);
    setBusy(false); writing.current = false;
  }

  const open = (value: Dialog) => { if (!busy && !loading && !refreshFailed) { setDialog(value); setModalError(''); setError(''); } };
  const close = () => { if (!writing.current) { setDialog(null); setModalError(''); } };
  const areaName = (id: string | null) => {
    if (!id) return 'Chưa xác định khu vực';
    const area = areas.find(item => item.id === id);
    return area ? `${area.code} — ${area.name}` : 'Khu vực không còn trong danh sách';
  };
  const rackName = (id: string) => {
    const rack = devices.find(item => item.id === id);
    return rack ? `${rack.code} — ${rack.name}` : 'Rack không còn trong danh sách';
  };
  const systemName = (id: string) => {
    const system = systems.find(item => item.id === id);
    return system ? `${system.code} — ${system.name}` : 'Hạng mục không còn trong danh sách';
  };
  const viewed = dialog && dialog.kind === 'view' ? dialog.device : null;
  const existing = dialog && dialog.kind === 'edit' ? dialog.device : undefined;
  const dateLabel = (value: string) => new Date(value).toLocaleString('vi-VN');

  return <section className="devices-panel" aria-busy={busy || loading} aria-label="Danh mục thiết bị">
    <div className="panel-heading device-panel-heading export-panel-heading"><div><h3>Thiết bị</h3><p className="device-caption">Mã nhãn, vị trí lắp đặt và hệ thống liên quan</p>{manager&&<p className="export-context">Excel phản ánh dữ liệu công trình hiện tại, không phải snapshot nghiệm thu.</p>}</div>
      {manager && <div className="export-heading-actions"><ExportDownloadButton token={token} projectId={projectId} kind="devices" label="Xuất Excel thiết bị" onSignOut={onSignOut}/><button className="button button-small" disabled={busy || loading || refreshFailed} onClick={() => open({ kind: 'create' })}>＋ Thiết bị</button></div>}
    </div>
    {!manager && <p className="device-caption">Danh mục chỉ đọc. Liên hệ quản lý khi cần thay đổi thông tin thiết bị.</p>}
    {notice && <div className="success-note" role="status">{notice}</div>}
    {error && <div className="error-note" role="alert">{error}{refreshFailed && <button className="retry-inline" onClick={() => void reload()}>Tải lại thiết bị</button>}</div>}
    {loading ? <div className="device-loading" role="status"><span className="spinner" />Đang tải thiết bị…</div> : refreshFailed ?
      <p className="device-caption">Danh sách cũ đã được ẩn để tránh thao tác lặp. Tải lại bằng nút trên hoặc tải lại trang.</p> : devices.length === 0 ?
      <div className="empty-panel"><h4>Chưa có thiết bị</h4><p>{manager ? 'Ghi nhận rack, switch, ổ mạng, AP hoặc camera của công trình. Thiết bị chưa rõ vị trí vẫn có thể được lưu.' : 'Thiết bị sẽ xuất hiện khi quản lý bổ sung vào công trình.'}</p></div> : <>
        <p className="device-caption">{devices.length} thiết bị · Sắp xếp theo mã nhãn</p>
        <div className="device-register-heading" aria-hidden="true"><span>Mã nhãn / thiết bị</span><span>Vị trí</span><span>Hệ thống / thao tác</span></div>
        <ListView rows={devices} label="thiết bị" className="device-list" text={d => `${d.code} ${d.name} ${areaName(d.effectiveAreaId)} ${d.systemIds.map(systemName).join(' ')}`} kind={d => deviceLabels[d.type]}>{device => <li className="device-row" key={device.id}>
          <div className="device-identity"><button className="device-code" onClick={() => open({ kind: 'view', device })} aria-label={`Xem ${device.code}`}>{device.code}</button><strong>{device.name}</strong><span className="device-type">{deviceLabels[device.type]}</span></div>
          <div className="device-location"><span className="device-mobile-label">Vị trí</span>{device.rackId ? <><strong>{rackName(device.rackId)}</strong><span>{areaName(device.effectiveAreaId)}</span><small>Kế thừa từ rack</small></> : <span>{areaName(device.effectiveAreaId)}</span>}{device.locationNote && <small>{device.locationNote}</small>}</div>
          <div className="device-relations"><span className="device-mobile-label">Hệ thống</span><ul className="device-system-tags">{device.systemIds.length ? device.systemIds.map(id => <li key={id}>{systemName(id)}</li>) : <li>Chưa liên kết hệ thống</li>}</ul><div className="device-actions"><button className="text-button" disabled={busy} onClick={() => open({ kind: 'view', device })}>Xem đầy đủ</button>{manager && <><button className="text-button" disabled={busy} onClick={() => open({ kind: 'edit', device })}>Sửa</button><button className="text-button device-delete" disabled={busy} onClick={() => open({ kind: 'delete', device })}>Xóa</button></>}</div></div>
        </li>}</ListView>
      </>}

    {dialog && <DeviceDialog title={dialog.kind === 'create' ? 'Thêm thiết bị' : dialog.kind === 'edit' ? 'Sửa thiết bị' : dialog.kind === 'delete' ? 'Xóa thiết bị' : 'Thông tin thiết bị'} busy={busy} error={modalError} onClose={close}>
      {(dialog.kind === 'create' || dialog.kind === 'edit') && <DeviceForm initial={existing} areas={areas} systems={systems} racks={devices.filter(device => device.type === 'RACK')} busy={busy} onCancel={close} onSave={input => void runWrite(
        () => existing ? updateDevice(token, projectId, existing.id, input as DeviceUpdate) : createDevice(token, projectId, input as DeviceInput),
        existing ? 'Đã lưu thiết bị.' : 'Đã tạo thiết bị.',
      )} />}
      {viewed && <><div className="device-detail-title"><span className="device-label">{viewed.code}</span><h3>{viewed.name}</h3><p>{deviceLabels[viewed.type]}</p></div><dl className="device-detail-grid">
        <div><dt>Vị trí trực tiếp</dt><dd>{viewed.areaId ? areaName(viewed.areaId) : 'Không đặt trực tiếp tại khu vực'}</dd></div>
        <div><dt>Tủ rack</dt><dd>{viewed.rackId ? rackName(viewed.rackId) : 'Không nằm trong rack'}</dd></div>
        <div><dt>Khu vực hiệu lực</dt><dd>{areaName(viewed.effectiveAreaId)}{viewed.rackId && ' (kế thừa từ rack)'}</dd></div>
        {viewed.type === 'RACK' && <div><dt>Dung lượng rack</dt><dd>{viewed.capacityU === null ? 'Chưa ghi nhận' : `${viewed.capacityU} U`}</dd></div>}
        <div><dt>Hãng</dt><dd>{viewed.brand || 'Chưa ghi nhận'}</dd></div><div><dt>Model</dt><dd>{viewed.model || 'Chưa ghi nhận'}</dd></div>
        <div><dt>Số serial</dt><dd>{viewed.serialNumber || 'Chưa ghi nhận'}</dd></div><div><dt>Ghi chú vị trí</dt><dd>{viewed.locationNote || 'Không có'}</dd></div>
        <div className="device-detail-wide"><dt>Hệ thống liên quan</dt><dd>{viewed.systemIds.length ? viewed.systemIds.map(systemName).join('; ') : 'Chưa liên kết hệ thống'}</dd></div>
        <div className="device-detail-wide"><dt>Mô tả</dt><dd>{viewed.description || 'Không có'}</dd></div>
        <div><dt>Ngày tạo</dt><dd>{dateLabel(viewed.createdAt)}</dd></div><div><dt>Cập nhật gần nhất</dt><dd>{dateLabel(viewed.updatedAt)}</dd></div>
      </dl><div className="form-actions"><button className="button button-quiet" onClick={close}>Đóng</button>{manager && <button className="button" onClick={() => open({ kind: 'edit', device: viewed })}>Sửa thiết bị</button>}</div></>}
      {dialog.kind === 'delete' && <><p className="device-delete-warning">Xóa <strong>{dialog.device.code} — {dialog.device.name}</strong> và các liên kết hệ thống của thiết bị? Thao tác này không thể hoàn tác.</p><p className="device-caption">Rack còn thiết bị hoặc thiết bị có dữ liệu phụ thuộc sẽ không được xóa (409).</p><div className="form-actions"><button className="button button-quiet" disabled={busy} onClick={close}>Hủy</button><button className="button device-danger-button" disabled={busy} onClick={() => void runWrite(() => deleteDevice(token, projectId, dialog.device.id), 'Đã xóa thiết bị.', true)}>{busy ? 'Đang xóa…' : 'Xóa thiết bị này'}</button></div></>}
    </DeviceDialog>}
  </section>;
}
