import { SetMetadata } from '@nestjs/common';

export const PASSWORD_CHANGE_ALLOWED = 'password-change-allowed';
export const PasswordChangeAllowed = () => SetMetadata(PASSWORD_CHANGE_ALLOWED, true);
