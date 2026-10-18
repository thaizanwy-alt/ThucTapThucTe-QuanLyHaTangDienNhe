import { useEffect, useRef, useState } from 'react';
import type { User } from './api/auth';
import { isCurrentSession, sessionIdFor } from './api/client';
import { getProjectSummary } from './api/project-summary';
import type { ProjectSummaryData } from './api/project-summary';
import type { SummaryDestination } from './summary-navigation';

interface Props {
  token: string; user: User; projectId: string;
  onOpen: (destination: SummaryDestination) => void;
  children: (inventory: ProjectSummaryData['inventory'] | undefined) => React.ReactNode;
}

export default function ProjectSummary({ token, user, projectId, onOpen, children }: Props) {
  const sessionId = sessionIdFor(token);
  const scope = `${projectId}:${sessionId}:${user.role}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; data: ProjectSummaryData } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const revision = useRef(0);
  const data = snapshot?.scope === scope ? snapshot.data : null;
  useEffect(() => {
    const request = ++revision.current, controller = new AbortController();
    let active = true;
    const current = () => active && request === revision.current && (sessionId === null || isCurrentSession(sessionId, token));
    setSnapshot(null); setLoading(true); setError('');
    void getProjectSummary(token, projectId, controller.signal).then(value => {
      if (current() && value.projectId === projectId) setSnapshot({ scope, data: value });
    }).catch(cause => {
      if (current()) setError(cause instanceof Error ? cause.message : 'Không tải được tổng kết.');
    }).finally(() => { if (current()) setLoading(false); });
    return () => { active = false; revision.current++; controller.abort(); };
  }, [token, projectId, sessionId, scope, reload]);

  const metric = (label: string, value: number, section: SummaryDestination['section'], group: SummaryDestination['group']) =>
    <button className="summary-metric" onClick={() => onOpen({ section, group })} key={group}><strong>{value}</strong><span>{label}</span></button>;
  const manager = user.role === 'MANAGER';
  return <>
    <section className="project-summary" aria-label="Tổng kết công trình" aria-busy={loading}>
      <div className="summary-heading"><h3>Tổng kết công trình</h3><button className="button button-small button-quiet" disabled={loading} onClick={() => { setSnapshot(null); setLoading(true); setError(''); setReload(value => value + 1); }}>Tải lại tổng kết</button></div>
      {loading && <p role="status">Đang đọc tổng kết…</p>}
      {error && <div className="error-note" role="alert">{error} Hãy tải lại tổng kết.</div>}
      {data && !loading && !error && <>
        <div className="summary-groups">
          <div><h4>{manager ? 'Công việc' : 'Việc của tôi'}</h4>{metric('Chưa duyệt', data.tasks.notApproved, 'tasks', 'notApproved')}<p>{data.tasks.total} việc {manager ? 'trong công trình' : 'được giao hiện hành'}</p></div>
          <div><h4>{manager ? 'Lỗi khắc phục' : 'Lỗi của tôi'}</h4>{metric('Chưa đóng', data.issues.notClosed, 'inspections', 'notClosed')}<p>{data.issues.total} lỗi {manager ? 'trong công trình' : 'được giao hiện hành'}</p></div>
          {manager && data.inspections && <div><h4>Phiếu kiểm tra</h4><div className="summary-metrics">{metric('Đạt', data.inspections.passed, 'inspections', 'passed')}{metric('Chưa kiểm tra', data.inspections.notChecked, 'inspections', 'notChecked')}{metric('Đang kiểm tra / chưa đạt', data.inspections.pendingOrFailed, 'inspections', 'pendingOrFailed')}</div></div>}
          <div><h4>Hồ sơ nghiệm thu</h4><div className="summary-metrics">{metric('Xác nhận hiện hành', data.acceptances.confirmedCurrent, 'inspections', 'confirmedCurrent')}{manager && data.acceptances.draft !== undefined && metric('Bản nháp', data.acceptances.draft, 'inspections', 'draft')}{metric('Đã thay thế', data.acceptances.superseded, 'inspections', 'superseded')}</div></div>
        </div>
        <p className="summary-read-at">Bắt đầu lượt đọc: <time dateTime={data.readAt}>{new Date(data.readAt).toLocaleString('vi-VN')}</time>.</p>
        <p className="summary-help">Mở chỉ số để tải danh sách mới; dữ liệu có thể đã thay đổi. Tổng kết không xác nhận điều kiện bàn giao toàn công trình.</p>
      </>}
    </section>
    {children(data && !loading && !error ? data.inventory : undefined)}
  </>;
}
