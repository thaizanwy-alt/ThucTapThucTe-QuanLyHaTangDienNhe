import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
interface Preference { query: string; filter: string; page: number; size: number }
const Preferences = createContext<Map<string, Preference> | null>(null);
export function ListPreferences({ children }: { children: ReactNode }) {
  const values = useRef(new Map<string, Preference>());
  return <Preferences.Provider value={values.current}>{children}</Preferences.Provider>;
}
export function listPage<T>(rows: T[], query: string, filter: string, text: (row: T) => string, kind: (row: T) => string, page: number, size = 6) {
  const matches = rows.filter(row => text(row).toLocaleLowerCase('vi').includes(query.trim().toLocaleLowerCase('vi')) && (!filter || kind(row) === filter));
  const pages = Math.max(1, Math.ceil(matches.length / size));
  const current = Math.max(1, Math.min(page, pages));
  return { rows: matches.slice((current - 1) * size, current * size), count: matches.length, pages, current };
}
export function listFilterOptions<T>(rows: T[], kind: (row: T) => string, selected: string) {
  return [...new Set([...rows.map(kind), selected])].filter(Boolean).sort();
}
export default function ListView<T>({ rows, text, kind, label, className, children, container = 'ul', preferenceKey = '' }: { rows: T[]; text: (row: T) => string; kind: (row: T) => string; label: string; className: string; children: (row: T) => ReactNode; container?: 'ul' | 'div'; preferenceKey?: string }) {
  const preferences = useContext(Preferences); const key = `${label}:${preferenceKey}`; const saved = preferences?.get(key);
  const [query, setQuery] = useState(saved?.query ?? ''); const [filter, setFilter] = useState(saved?.filter ?? ''); const [page, setPage] = useState(saved?.page ?? 1); const [size, setSize] = useState(saved?.size ?? 6);
  const result = listPage(rows, query, filter, text, kind, page, size);
  useEffect(() => { if (page !== result.current) setPage(result.current); }, [page, result.current]);
  useEffect(() => { preferences?.set(key, { query, filter, page: result.current, size }); }, [preferences, key, query, filter, result.current, size]);
  const Container = container;
  return <div className="list-browser">
    <div className="list-controls"><label>Tìm {label}<input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label><label>Lọc {label}<select aria-label={`Lọc ${label}`} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}><option value="">Tất cả</option>{listFilterOptions(rows, kind, filter).map(value => <option key={value} value={value}>{value}{rows.some(row => kind(row) === value) ? '' : ' (0)'}</option>)}</select></label></div>
    {!result.count && <p role="status">Không có kết quả phù hợp.</p>}
    <Container className={className}>{result.rows.map(children)}</Container>
    <div className="list-pagination"><span>{result.count} kết quả · Trang {result.current}/{result.pages}</span><label>Số dòng<select aria-label={`Số dòng ${label}`} value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1); }}>{[6,12,24].map(n => <option key={n}>{n}</option>)}</select></label><button className="button button-small button-quiet" disabled={result.current === 1} onClick={() => setPage(result.current - 1)}>Trước</button><button className="button button-small button-quiet" disabled={result.current === result.pages} onClick={() => setPage(result.current + 1)}>Sau</button></div>
  </div>;
}
