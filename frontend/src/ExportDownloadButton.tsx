import { useEffect, useRef, useState } from 'react';
import { ApiError } from './api/client';
import { requestExport } from './api/exports';
import type { ExportKind } from './api/exports';
import './export.css';

type Props = { token: string; projectId: string; kind: ExportKind; acceptanceId?: string;
  label: string; onSignOut: () => void; disabled?: boolean };

export default function ExportDownloadButton({ token, projectId, kind, acceptanceId, label, onSignOut, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = `${projectId}:${kind}:${acceptanceId ?? ''}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      active.current?.abort(); active.current = null;
      for (const timer of timers.current) clearTimeout(timer);
      timers.current.clear();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, [scope]);

  async function download() {
    if (disabled || active.current) return;
    const request = ++generation.current;
    const controller = new AbortController(); active.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, kind === 'handover-package' ? 125000 : 60000);
    const current = () => alive.current && generation.current === request && scopeRef.current === scope;
    setBusy(true); setError('');
    try {
      const file = await requestExport(token, projectId, kind, controller.signal, acceptanceId);
      if (!current()) return;
      const url = URL.createObjectURL(file.blob); urls.current.add(url);
      const link = document.createElement('a'); link.href = url; link.download = file.name;
      document.body.appendChild(link); link.click(); link.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); timers.current.delete(timer); }, 1000);
      timers.current.add(timer);
    } catch (cause) {
      if (!current()) return;
      if (cause instanceof ApiError && cause.status === 401) onSignOut();
      setError(timedOut ? 'Xuất file quá thời gian chờ. Hãy thử lại.' :
        cause instanceof Error ? cause.message : 'Không tải được file xuất.');
    } finally {
      clearTimeout(timeout);
      if (current()) { active.current = null; setBusy(false); }
    }
  }

  return <div className="export-control">
    <button type="button" className="button button-small button-quiet" disabled={disabled || busy}
      onClick={() => void download()}>{busy ? 'Đang xuất…' : label}</button>
    {error && <p className="export-error" role="alert">{error}</p>}
  </div>;
}
