import { apiRequest } from './client';
export interface ManagedTechnician {
  id: string; email: string; role: 'TECHNICIAN'; isActive: boolean; mustChangePassword: boolean; version: number;
}
export interface OpenWork {
  taskCount: number; issueCount: number;
  tasks: { id: string; projectId: string; code: string; status: string }[];
  issues: { id: string; projectId: string; status: string }[];
}
export const listManagedTechnicians = (token: string) => apiRequest<ManagedTechnician[]>('/users/technicians/manage', { token });
export const createTechnician = (token: string, email: string, temporaryPassword: string) => apiRequest<ManagedTechnician>('/users/technicians', {
  token, method: 'POST', body: JSON.stringify({ email: email.trim(), temporaryPassword }),
});
export const resetTechnician = (token: string, row: ManagedTechnician, temporaryPassword: string) => apiRequest<ManagedTechnician>(`/users/technicians/${encodeURIComponent(row.id)}/password-reset`, {
  token, method: 'POST', body: JSON.stringify({ expectedVersion: row.version, temporaryPassword }),
});
export const setTechnicianStatus = (token: string, row: ManagedTechnician, isActive: boolean) => apiRequest<ManagedTechnician>(`/users/technicians/${encodeURIComponent(row.id)}/status`, {
  token, method: 'PATCH', body: JSON.stringify({ expectedVersion: row.version, isActive }),
});
export const changePassword = (token: string, expectedVersion: number, currentPassword: string, newPassword: string) => apiRequest<void>('/auth/change-password', {
  token, method: 'POST', body: JSON.stringify({ expectedVersion, currentPassword, newPassword }),
});
