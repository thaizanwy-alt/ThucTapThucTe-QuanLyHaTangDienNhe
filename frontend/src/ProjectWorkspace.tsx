import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from './api/client';
import {
  createArea, createProject, createSystem, deleteArea, deleteSystem, listAreas, listProjects,
  listSystems, updateArea, updateProject, updateSystem,
} from './api/projects';
import type {
  AreaType, Project, ProjectArea, ProjectInput, ProjectStatus, ProjectSystem, SystemCategory,
} from './api/projects';
import type { User } from './api/auth';
import TaskPanel from './TaskPanel';
import DevicePanel from './DevicePanel';
import ConnectionPanel from './ConnectionPanel';
import RackWorkspace from './RackWorkspace';
import InspectionWorkspace from './InspectionWorkspace';
import './workspace.css';
import { useDialogFocus } from './useDialogFocus';
import { ListPreferences } from './ListView';
const sections = { overview: 'Tổng quan', structure: 'Khu vực & hệ thống', devices: 'Thiết bị', tasks: 'Công việc', connections: 'Đấu nối & tra cứu', inspections: 'Kiểm tra', racks: 'Sơ đồ tủ' } as const;
type Section = keyof typeof sections;

interface Props {
  token: string;
  user: User;
  onSignOut: () => void;
}

type ProjectEditor = Project | 'new' | null;
type AreaEditor = { id?: string; type: AreaType; code: string; name: string; parentId: string; sortOrder: number } | null;
type SystemEditor = ProjectSystem | 'new' | null;

const statusLabels: Record<ProjectStatus, string> = {
  PLANNING: 'Chuẩn bị',
  IN_PROGRESS: 'Đang thi công',
  WAITING_ACCEPTANCE: 'Chờ nghiệm thu',
  COMPLETED: 'Hoàn thành',
};

const categoryLabels: Record<SystemCategory, string> = { LAN: 'Mạng LAN', WIFI: 'WiFi', CAMERA: 'Camera' };
const SAVE_REFRESH_FAILED = 'Đã lưu trên server nhưng chưa tải lại được, hãy tải lại trang.';
const DELETE_REFRESH_FAILED = 'Đã xóa trên server nhưng chưa tải lại được, hãy tải lại trang.';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Có lỗi xảy ra. Vui lòng thử lại.';
}

function Modal({ title, onClose, error, children }: { title: string; onClose: () => void; error: string; children: ReactNode }) {
  const ref = useDialogFocus(title);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Đóng">×</button></div>
        {error && <div className="error-note modal-error" role="alert">{error}</div>}
        {children}
      </section>
    </div>
  );
}

function ProjectForm({ initial, busy, onCancel, onSave }: {
  initial?: Project; busy: boolean; onCancel: () => void; onSave: (input: ProjectInput) => void;
}) {
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? 'PLANNING');
  const [description, setDescription] = useState(initial?.description ?? '');
  return (
    <form className="form-stack" onSubmit={event => {
      event.preventDefault();
      onSave({ code, name, address: address || null, status, description: description || null });
    }}>
      <div className="form-grid">
        <label>Mã công trình<input value={code} onChange={event => setCode(event.target.value)} maxLength={40} required placeholder="VD: CT-024" /></label>
        <label>Tên công trình<input value={name} onChange={event => setName(event.target.value)} required placeholder="Tên theo hồ sơ dự án" /></label>
      </div>
      <label>Địa chỉ<input value={address} onChange={event => setAddress(event.target.value)} placeholder="Địa chỉ công trình" /></label>
      <label>Trạng thái<select value={status} onChange={event => setStatus(event.target.value as ProjectStatus)}>
        {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Mô tả<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="Thông tin thêm nếu có" /></label>
      <div className="form-actions"><button type="button" className="button button-quiet" onClick={onCancel}>Hủy</button><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu công trình'}</button></div>
    </form>
  );
}

function AreaForm({ initial, floors, busy, onCancel, onSave }: {
  initial: NonNullable<AreaEditor>; floors: ProjectArea[]; busy: boolean; onCancel: () => void;
  onSave: (value: { code: string; name: string; type?: AreaType; parentId?: string | null; sortOrder?: number }) => void;
}) {
  const [code, setCode] = useState(initial.code);
  const [name, setName] = useState(initial.name);
  const [parentId, setParentId] = useState(initial.parentId);
  const [sortOrder, setSortOrder] = useState(String(initial.sortOrder));
  return (
    <form className="form-stack compact-form" onSubmit={event => {
      event.preventDefault();
      onSave({ code, name, ...(initial.id ? {} : { type: initial.type }), parentId: initial.type === 'ROOM' ? parentId : null, sortOrder: Number(sortOrder) });
    }}>
      <label>{initial.type === 'FLOOR' ? 'Mã tầng' : 'Mã phòng'}<input value={code} onChange={event => setCode(event.target.value)} maxLength={40} required placeholder={initial.type === 'FLOOR' ? 'TANG-01' : 'P-101'} /></label>
      <label>Tên hiển thị<input value={name} onChange={event => setName(event.target.value)} required placeholder={initial.type === 'FLOOR' ? 'Tầng 1' : 'Phòng kỹ thuật'} /></label>
      {initial.type === 'ROOM' && <label>Tầng<select required value={parentId} onChange={event => setParentId(event.target.value)}><option value="">Chọn tầng</option>{floors.map(floor => <option key={floor.id} value={floor.id}>{floor.name} · {floor.code}</option>)}</select></label>}
      <label>Thứ tự<input type="number" min="0" step="1" value={sortOrder} onChange={event => setSortOrder(event.target.value)} required /></label>
      <div className="form-actions"><button type="button" className="button button-quiet" onClick={onCancel}>Hủy</button><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu khu vực'}</button></div>
    </form>
  );
}

function SystemForm({ initial, busy, onCancel, onSave }: {
  initial: SystemEditor; busy: boolean; onCancel: () => void;
  onSave: (value: { code: string; name: string; category: SystemCategory; description: string | null }) => void;
}) {
  const existing = initial && initial !== 'new' ? initial : undefined;
  const [code, setCode] = useState(existing?.code ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState<SystemCategory>(existing?.category ?? 'LAN');
  const [description, setDescription] = useState(existing?.description ?? '');
  return (
    <form className="form-stack compact-form" onSubmit={event => {
      event.preventDefault(); onSave({ code, name, category, description: description || null });
    }}>
      <label>Mã hạng mục<input value={code} onChange={event => setCode(event.target.value)} maxLength={40} required placeholder="VD: LAN-TANG-01" /></label>
      <label>Tên hạng mục<input value={name} onChange={event => setName(event.target.value)} required placeholder="VD: Mạng tầng 1" /></label>
      <label>Loại hệ thống<select value={category} onChange={event => setCategory(event.target.value as SystemCategory)}>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Mô tả<textarea rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="Mô tả phạm vi hạng mục" /></label>
      <div className="form-actions"><button type="button" className="button button-quiet" onClick={onCancel}>Hủy</button><button className="button" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu hạng mục'}</button></div>
    </form>
  );
}

export default function ProjectWorkspace({ token, user, onSignOut }: Props) {
  const manager = user.role === 'MANAGER';
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [areas, setAreas] = useState<ProjectArea[]>([]);
  const [systems, setSystems] = useState<ProjectSystem[]>([]);
  const [deviceRevision, setDeviceRevision] = useState(0);
  const [section, setSection] = useState<Section>('overview');
  const contentRef = useRef<HTMLDivElement>(null);
  const [sectionWarning, setSectionWarning] = useState('');
  const rackScreen = section === 'racks';
  function navigate(next: Section) {
    if (contentRef.current?.querySelector('[role="dialog"], [aria-busy="true"]')) { setSectionWarning('Hãy đóng hộp thoại hoặc chờ thao tác đang thực hiện trước khi chuyển mục.'); return; }
    const warning = Array.from(contentRef.current?.querySelectorAll('[role="alert"], .connection-warning') ?? []).map(node => node.textContent).join(' ');
    if (warning) setSectionWarning(`${sections[section]}: ${warning}. Mở lại mục để tải mới bằng GET.`);
    if (next === 'structure' && selectedId) void refreshDetail(selectedId);
    setSection(next);
  }
  useEffect(() => { setSection('overview'); setSectionWarning(''); }, [selectedId]);
  useEffect(() => { (section === 'overview' ? document.querySelector<HTMLElement>('.overview-links button') : document.getElementById('function-title'))?.focus(); }, [section]);
  const [loadedDetailId, setLoadedDetailId] = useState<string | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailRefreshFailed, setDetailRefreshFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectEditor, setProjectEditor] = useState<ProjectEditor>(null);
  const [areaEditor, setAreaEditor] = useState<AreaEditor>(null);
  const [systemEditor, setSystemEditor] = useState<SystemEditor>(null);
  const detailRequest = useRef(0);
  const onDeviceChanged = useCallback(() => setDeviceRevision(value => value + 1), []);

  const selectedProject = projects.find(project => project.id === selectedId) ?? null;
  const detailReady = selectedId !== null && loadedDetailId === selectedId && !loadingDetail && !detailRefreshFailed;
  const floors = useMemo(() => areas.filter(area => area.type === 'FLOOR'), [areas]);
  const roomsByFloor = useMemo(() => {
    const grouped = new Map<string, ProjectArea[]>();
    for (const room of areas.filter(area => area.type === 'ROOM')) {
      if (!room.parentId) continue;
      grouped.set(room.parentId, [...(grouped.get(room.parentId) ?? []), room]);
    }
    return grouped;
  }, [areas]);

  const refreshProjects = useCallback(async (selectId?: string) => {
    const rows = await listProjects(token);
    setProjects(rows);
    setSelectedId(current => {
      const next = selectId ?? current;
      return rows.some(project => project.id === next) ? next : null;
    });
  }, [token, onSignOut]);

  useEffect(() => {
    let active = true;
    setLoadingProjects(true); setError('');
    listProjects(token).then(rows => { if (active) setProjects(rows); })
      .catch(cause => {
        if (!active) return;
        setError(messageOf(cause));
        if (cause instanceof ApiError && cause.status === 401) onSignOut();
      })
      .finally(() => { if (active) setLoadingProjects(false); });
    return () => { active = false; };
  }, [token]);

  const refreshDetail = useCallback(async (projectId: string, failureMessage?: string): Promise<boolean> => {
    const requestId = ++detailRequest.current;
    setLoadingDetail(true); setLoadedDetailId(null); setDetailRefreshFailed(false); setError('');
    try {
      const [areaRows, systemRows] = await Promise.all([listAreas(token, projectId), listSystems(token, projectId)]);
      if (requestId === detailRequest.current) {
        setAreas(areaRows); setSystems(systemRows); setLoadedDetailId(projectId); setDetailRefreshFailed(false);
      }
      return requestId === detailRequest.current;
    } catch (cause) {
      if (requestId === detailRequest.current) {
        setError(failureMessage ?? messageOf(cause));
        setNotice('');
        setDetailRefreshFailed(true);
      }
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
      return false;
    } finally { if (requestId === detailRequest.current) setLoadingDetail(false); }
  }, [token, onSignOut]);

  useEffect(() => {
    if (selectedId) void refreshDetail(selectedId);
    else { detailRequest.current++; setAreas([]); setSystems([]); setLoadedDetailId(null); setDetailRefreshFailed(false); }
  }, [selectedId, refreshDetail]);

  async function saveProject(input: ProjectInput) {
    setSaving(true); setError(''); setNotice('');
    let result: Project;
    try {
      result = projectEditor === 'new'
        ? await createProject(token, input)
        : await updateProject(token, projectEditor!.id, input);
    } catch (cause) {
      setError(messageOf(cause));
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
      setSaving(false);
      return;
    }
    setProjectEditor(null);
    try { await refreshProjects(result.id); setNotice('Đã lưu thông tin công trình.'); }
    catch (cause) {
      setError(SAVE_REFRESH_FAILED);
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
    }
    finally { setSaving(false); }
  }

  function beginArea(type: AreaType, parentId = '') {
    setAreaEditor({ type, parentId, code: '', name: '', sortOrder: type === 'FLOOR' ? floors.length : 0 });
    setError('');
  }

  async function saveArea(input: { code: string; name: string; type?: AreaType; parentId?: string | null; sortOrder?: number }) {
    if (!selectedId || !areaEditor) return;
    setSaving(true); setError(''); setNotice('');
    try {
      if (areaEditor.id) await updateArea(token, selectedId, areaEditor.id, input);
      else await createArea(token, selectedId, { ...input, type: areaEditor.type });
      setAreaEditor(null);
      if (await refreshDetail(selectedId, SAVE_REFRESH_FAILED)) setNotice('Đã lưu khu vực.');
    } catch (cause) { setError(messageOf(cause)); if (cause instanceof ApiError && cause.status === 401) onSignOut(); }
    finally { setSaving(false); }
  }

  async function removeArea(area: ProjectArea) {
    if (!selectedId || !window.confirm(`Xóa ${area.type === 'FLOOR' ? 'tầng' : 'phòng'} “${area.name}”?`)) return;
    setError(''); setNotice('');
    try {
      await deleteArea(token, selectedId, area.id);
      if (await refreshDetail(selectedId, DELETE_REFRESH_FAILED)) setNotice('Đã xóa khu vực.');
    }
    catch (cause) { setError(messageOf(cause)); if (cause instanceof ApiError && cause.status === 401) onSignOut(); }
  }

  async function saveSystem(input: { code: string; name: string; category: SystemCategory; description: string | null }) {
    if (!selectedId || !systemEditor) return;
    setSaving(true); setError(''); setNotice('');
    try {
      if (systemEditor === 'new') await createSystem(token, selectedId, input);
      else await updateSystem(token, selectedId, systemEditor.id, input);
      setSystemEditor(null);
      if (await refreshDetail(selectedId, SAVE_REFRESH_FAILED)) setNotice('Đã lưu hạng mục hệ thống.');
    } catch (cause) { setError(messageOf(cause)); if (cause instanceof ApiError && cause.status === 401) onSignOut(); }
    finally { setSaving(false); }
  }

  async function removeSystem(system: ProjectSystem) {
    if (!selectedId || !window.confirm(`Xóa hạng mục “${system.name}”?`)) return;
    setError(''); setNotice('');
    try {
      await deleteSystem(token, selectedId, system.id);
      if (await refreshDetail(selectedId, DELETE_REFRESH_FAILED)) setNotice('Đã xóa hạng mục.');
    }
    catch (cause) { setError(messageOf(cause)); if (cause instanceof ApiError && cause.status === 401) onSignOut(); }
  }

  const openProjectEditor = (project: Project | 'new') => { setError(''); setProjectEditor(project); };
  const beginEditArea = (area: ProjectArea) => {
    setError('');
    setAreaEditor({
      id: area.id, type: area.type, code: area.code, name: area.name,
      parentId: area.parentId ?? '', sortOrder: area.sortOrder,
    });
  };
  const openSystemEditor = (system: SystemEditor) => { setError(''); setSystemEditor(system); };

  return (
    <div className="workspace-shell">
      <header className="topbar">
        <a className="brand brand-link" href="#projects" onClick={event => { event.preventDefault(); setSelectedId(null); }}>
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-copy">Hạ tầng điện nhẹ<small>Hồ sơ thi công</small></span>
        </a>
        <div className="account-actions"><span className="role-chip">{manager ? 'Quản lý' : 'Kỹ thuật viên'}</span><span className="account-email">{user.email}</span><button className="button button-quiet signout" onClick={onSignOut}>Đăng xuất</button></div>
      </header>

      <main className={`workspace ${selectedProject ? 'has-selection' : ''}`}>
        <aside className="project-rail" aria-label="Danh sách công trình">
          <div className="rail-heading"><div><span className="section-kicker">Hồ sơ công trình</span><h1>Công trình</h1></div>{manager && <button className="button button-small" onClick={() => openProjectEditor('new')}>Tạo mới</button>}</div>
          <div className="project-count">{loadingProjects ? 'Đang tải danh sách…' : `${projects.length} công trình`}</div>
          {error && !selectedProject && <div className="inline-error" role="alert">{error}<button onClick={() => { setError(''); setLoadingProjects(true); void refreshProjects().catch(cause => setError(messageOf(cause))).finally(() => setLoadingProjects(false)); }}>Thử lại</button></div>}
          {!loadingProjects && projects.length === 0 && !error && <div className="empty-rail"><span className="empty-mark">＋</span><h2>Chưa có công trình</h2><p>Tạo hồ sơ đầu tiên để bắt đầu tổ chức tầng, phòng và hệ thống.</p>{manager && <button className="text-button" onClick={() => openProjectEditor('new')}>Tạo công trình đầu tiên</button>}</div>}
          {projects.length > 0 && <ul className="project-list">{projects.map(project => (
            <li key={project.id}><button className={`project-row ${project.id === selectedId ? 'active' : ''}`} onClick={() => { setSelectedId(project.id); setError(''); setNotice(''); }}>
              <span className="project-row-mark" aria-hidden="true">{project.code.slice(0, 1)}</span>
              <span className="project-row-copy"><strong>{project.name}</strong><small>{project.code}</small></span>
              <span className={`status-dot status-${project.status.toLowerCase()}`} title={statusLabels[project.status]} />
            </button></li>
          ))}</ul>}
          <div className="rail-legend"><span className="status-dot status-in_progress" />Đang thi công <span className="status-dot status-completed" />Hoàn thành</div>
        </aside>

        <section className="project-detail" aria-live="polite">
          {!selectedProject && <div className="welcome-state">
            <div className="blueprint-illustration" aria-hidden="true"><span className="blueprint-building"><i /><i /><i /><i /><b /></span><span className="blueprint-line line-one" /><span className="blueprint-line line-two" /></div>
            <span className="section-kicker">Không gian dự án</span><h2>Chọn một công trình</h2><p>Mỗi công trình tập hợp cấu trúc tầng, phòng và các hệ thống mạng, WiFi, camera.</p>
            {manager && projects.length > 0 && <button className="button" onClick={() => openProjectEditor('new')}>Tạo công trình</button>}
          </div>}

          {selectedProject && <>
            <div className="detail-heading">
              <div><button className="back-projects" onClick={() => setSelectedId(null)}>← Danh sách công trình</button><div className="title-line"><span className="project-code">{selectedProject.code}</span><h2>{selectedProject.name}</h2></div><p className="project-address">{selectedProject.address || 'Chưa cập nhật địa chỉ'}</p></div>
              <div className="detail-actions"><span className={`status-label status-label-${selectedProject.status.toLowerCase()}`}>{statusLabels[selectedProject.status]}</span>{manager && <button className="button button-quiet" onClick={() => openProjectEditor(selectedProject)}>Sửa hồ sơ</button>}</div>
            </div>
            {section === 'overview' && selectedProject.description && <p className="project-description">{selectedProject.description}</p>}
            {section !== 'overview' && <div className="function-heading"><button className="button button-quiet" onClick={() => navigate('overview')}>Về tổng quan</button><h3 tabIndex={-1} id="function-title">{sections[section]}</h3></div>}
            {sectionWarning && <div className="error-note" role="alert">{sectionWarning}<button onClick={() => setSectionWarning('')} aria-label="Đóng cảnh báo mục">×</button></div>}
            <ListPreferences key={`${selectedProject.id}:${section}`}><div ref={contentRef}>
            {!manager && <div className="read-only-note">Bạn được cập nhật công việc và lỗi khắc phục được giao; danh mục công trình ở chế độ chỉ đọc.</div>}
            {notice && <div className="success-note" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Đóng thông báo">×</button></div>}
            {error && <div className="error-note" role="alert">{error}<button onClick={() => setError('')} aria-label="Đóng thông báo">×</button></div>}
            {detailReady && rackScreen && <RackWorkspace key={`racks:${selectedProject.id}`} token={token} user={user} projectId={selectedProject.id} areas={areas} systems={systems} deviceRevision={deviceRevision} expanded={rackScreen} onOpen={() => navigate('racks')} onBack={() => navigate('overview')} onSignOut={onSignOut} />}
            {detailRefreshFailed ? <div className="detail-loading">Dữ liệu chưa được tải lại.<button className="retry-inline" onClick={() => { if (selectedId) void refreshDetail(selectedId); }}>Tải lại cấu trúc</button></div> : !detailReady ? <div className="detail-loading" role="status"><span className="spinner" />Đang tải cấu trúc công trình…</div> : section === 'structure' && <div className="detail-grid">
              <section className="structure-panel">
                <div className="panel-heading"><div><span className="section-kicker">Không gian</span><h3>Tầng và phòng</h3></div>{manager && <div className="menu-wrap"><button className="button button-small button-quiet" onClick={() => beginArea('FLOOR')}>＋ Tầng</button></div>}</div>
                {areas.length === 0 ? <div className="empty-panel"><span className="empty-mark">⌂</span><h4>Chưa có tầng hoặc phòng</h4><p>Thêm tầng trước, sau đó đặt các phòng bên dưới.</p>{manager && <button className="text-button" onClick={() => beginArea('FLOOR')}>Thêm tầng đầu tiên</button>}</div> : <div className="area-tree">
                  {floors.map((floor, index) => <div className="floor-group" key={floor.id}>
                    <div className="area-row floor-row"><span className="floor-index">{String(index + 1).padStart(2, '0')}</span><span className="area-glyph floor-glyph" aria-hidden="true"><i /></span><span className="area-copy"><strong>{floor.name}</strong><small>{floor.code}</small></span><span className="area-count">{(roomsByFloor.get(floor.id) ?? []).length} phòng</span>{manager && <div className="row-tools"><button className="icon-button" onClick={() => beginArea('ROOM', floor.id)} aria-label={`Thêm phòng vào ${floor.name}`}>＋</button><button className="icon-button" onClick={() => beginEditArea(floor)} aria-label={`Sửa ${floor.name}`}>···</button><button className="icon-button danger-tool" onClick={() => void removeArea(floor)} aria-label={`Xóa ${floor.name}`}>×</button></div>}</div>
                    <div className="room-list">{(roomsByFloor.get(floor.id) ?? []).map(room => <div className="area-row room-row" key={room.id}><span className="room-connector" aria-hidden="true" /><span className="area-glyph room-glyph" aria-hidden="true" /><span className="area-copy"><strong>{room.name}</strong><small>{room.code}</small></span>{manager && <div className="row-tools"><button className="icon-button" onClick={() => beginEditArea(room)} aria-label={`Sửa ${room.name}`}>···</button><button className="icon-button danger-tool" onClick={() => void removeArea(room)} aria-label={`Xóa ${room.name}`}>×</button></div>}</div>)}</div>
                  </div>)}
                  {areas.filter(area => area.type === 'ROOM' && !floors.some(floor => floor.id === area.parentId)).map(room => <div className="area-row room-row orphan-room" key={room.id}><span className="room-connector" /><span className="area-glyph room-glyph" /><span className="area-copy"><strong>{room.name}</strong><small>{room.code} · chưa gắn tầng</small></span>{manager && <button className="icon-button" onClick={() => beginEditArea(room)} aria-label={`Sửa ${room.name}`}>···</button>}</div>)}
                </div>}
              </section>

              <section className="systems-panel">
                <div className="panel-heading"><div><span className="section-kicker">Phạm vi thi công</span><h3>Hệ thống</h3></div>{manager && <button className="button button-small" onClick={() => openSystemEditor('new')}>＋ Hạng mục</button>}</div>
                <div className="system-summary"><span>{systems.length} hạng mục</span><span className="summary-divider" />{(['LAN', 'WIFI', 'CAMERA'] as SystemCategory[]).map(category => <span key={category} className="summary-type"><i className={`category-swatch swatch-${category.toLowerCase()}`} />{systems.filter(system => system.category === category).length} {category}</span>)}</div>
                {systems.length === 0 ? <div className="empty-panel system-empty"><span className="empty-mark">⌁</span><h4>Chưa có hạng mục hệ thống</h4><p>Ghi nhận các hệ thống thuộc phạm vi công trình.</p>{manager && <button className="text-button" onClick={() => openSystemEditor('new')}>Thêm hạng mục đầu tiên</button>}</div> : <ul className="system-list">{systems.map(system => <li className="system-row" key={system.id}>
                  <span className={`system-icon system-${system.category.toLowerCase()}`} aria-hidden="true">{system.category === 'LAN' ? '⌁' : system.category === 'WIFI' ? '◔' : '◎'}</span>
                  <span className="system-copy"><strong>{system.name}</strong><small>{system.code}{system.description ? ` · ${system.description}` : ''}</small></span>
                  <span className={`category-tag tag-${system.category.toLowerCase()}`}>{categoryLabels[system.category]}</span>
                  {manager && <div className="row-tools"><button className="icon-button" onClick={() => openSystemEditor(system)} aria-label={`Sửa ${system.name}`}>···</button><button className="icon-button danger-tool" onClick={() => void removeSystem(system)} aria-label={`Xóa ${system.name}`}>×</button></div>}
                </li>)}</ul>}
              </section>
            </div>}
            {detailReady && section === 'overview' && <div className="overview-info"><div className="overview-links" aria-label="Chức năng công trình">{Object.entries(sections).filter(([key]) => key !== 'overview').map(([key, label]) => <button key={key} onClick={() => navigate(key as Section)}><strong>{label}</strong><small>{key === 'structure' ? `${areas.length} khu vực · ${systems.length} hệ thống` : `Mở hồ sơ ${label.toLowerCase()}`}</small></button>)}</div></div>}
            {detailReady && section === 'tasks' && <TaskPanel key={selectedProject.id} token={token} user={user} projectId={selectedProject.id} systems={systems} areas={areas} onSignOut={onSignOut} />}
            {detailReady && section === 'inspections' && <InspectionWorkspace key={`inspections:${selectedProject.id}`} token={token} user={user} projectId={selectedProject.id} systems={systems} areas={areas} deviceRevision={deviceRevision} onSignOut={onSignOut} />}
            {detailReady && section === 'devices' && <DevicePanel key={`devices:${selectedProject.id}`} token={token} user={user} projectId={selectedProject.id} systems={systems} areas={areas} onSignOut={onSignOut} onDeviceChanged={onDeviceChanged} />}
            {detailReady && section === 'connections' && <ConnectionPanel key={`connections:${selectedProject.id}`} token={token} user={user} projectId={selectedProject.id} deviceRevision={deviceRevision} onSignOut={onSignOut} />}
            </div></ListPreferences>
          </>}
        </section>
      </main>

      {projectEditor && <Modal title={projectEditor === 'new' ? 'Tạo công trình' : 'Sửa hồ sơ công trình'} error={error} onClose={() => setProjectEditor(null)}><ProjectForm initial={projectEditor === 'new' ? undefined : projectEditor} busy={saving} onCancel={() => setProjectEditor(null)} onSave={input => void saveProject(input)} /></Modal>}
      {areaEditor && <Modal title={areaEditor.id ? `Sửa ${areaEditor.type === 'FLOOR' ? 'tầng' : 'phòng'}` : `Thêm ${areaEditor.type === 'FLOOR' ? 'tầng' : 'phòng'}`} error={error} onClose={() => setAreaEditor(null)}><AreaForm initial={areaEditor} floors={floors} busy={saving} onCancel={() => setAreaEditor(null)} onSave={input => void saveArea(input)} /></Modal>}
      {systemEditor && <Modal title={systemEditor === 'new' ? 'Thêm hạng mục hệ thống' : 'Sửa hạng mục hệ thống'} error={error} onClose={() => setSystemEditor(null)}><SystemForm initial={systemEditor} busy={saving} onCancel={() => setSystemEditor(null)} onSave={input => void saveSystem(input)} /></Modal>}
    </div>
  );
}
