import { UserRole } from '../users/user-role.enum';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  version: number;
}

export interface AccessTokenPayload {
  sub: string;
  authVersion: number;
}
