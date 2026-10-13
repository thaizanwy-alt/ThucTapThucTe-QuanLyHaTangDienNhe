import { apiRequest } from './client';
import { evidenceRequest } from './evidence';
import type { Inspection } from './inspections';
import type { Project, ProjectSystem, ProjectArea } from './projects';
import type { ProjectDevice } from './devices';
export interface Summary { inspectionCount: number; itemCount: number; evidenceCount: number }
export interface Snapshot {
  schemaVersion: number; sourceFingerprint: string; createdAt: string;
  content: { project: Project; system: ProjectSystem; acceptance: { note: string | null; replacementReason: string | null };
    inspections: (Inspection & { area: ProjectArea | null; device: ProjectDevice | null })[];
    evidence: { id: string; originalName: string; mimeType: string; sizeBytes: number; caption: string | null; sha256: string }[]; summary: Summary };
}
export interface Acceptance {
  id: string; projectId: string; systemId: string; code: string; title: string; status: 'DRAFT' | 'CONFIRMED'; version: number;
  confirmedAt: string | null; replacesId: string | null; replacedById: string | null;
  note?: string | null; inspectionIds?: string[]; evidenceIds?: string[]; snapshot?: Snapshot | null;
  project?: Pick<Project, 'id' | 'code' | 'name'>; system?: Pick<ProjectSystem, 'id' | 'code' | 'name' | 'category'>; summary?: Summary;
}
export interface Selection { code: string; title: string; inspectionIds: string[]; evidenceIds: string[] }
export interface Readiness { eligible: boolean; blockers: string[]; sourceFingerprint: string; version: number }
const path = (p: string, id?: string) => `/projects/${encodeURIComponent(p)}/acceptances${id ? '/' + encodeURIComponent(id) : ''}`;
export const listAcceptances = (t: string, p: string) => apiRequest<Acceptance[]>(path(p), { token: t });
export const getAcceptance = (t: string, p: string, id: string) => apiRequest<Acceptance>(path(p,id), { token: t });
export function writeAcceptance(t: string, p: string, id: string | null, mode: 'create' | 'edit' | 'replacement', body: object) {
  return apiRequest<Acceptance>(path(p,id ?? undefined) + (mode === 'replacement' ? '/replacement' : ''), { token:t, method: mode === 'edit' ? 'PATCH' : 'POST', body: JSON.stringify(body) });
}
export const getReadiness = (t: string,p: string,id: string) => apiRequest<Readiness>(path(p,id)+'/readiness',{token:t});
export const confirmAcceptance = (t: string,p: string,id: string,r: Readiness) => apiRequest<Acceptance>(path(p,id)+'/confirm',{token:t,method:'POST',body:JSON.stringify({expectedVersion:r.version,expectedSourceFingerprint:r.sourceFingerprint})});
export const acceptanceBlob = (t: string,p: string,id: string,file: string,preview: boolean) => evidenceRequest<Blob>(t,path(p,id)+`/files/${encodeURIComponent(file)}/${preview?'preview':'content'}`,{},true);
