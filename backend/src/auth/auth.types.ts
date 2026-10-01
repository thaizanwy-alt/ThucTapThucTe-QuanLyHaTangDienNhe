import { UserRole } from '../users/user-role.enum';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
}

export interface AccessTokenPayload {
  sub: string;
}
