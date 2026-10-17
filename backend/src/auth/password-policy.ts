import { BadRequestException } from '@nestjs/common';

export function validatePassword(value: string): void {
  // bcrypt consumes at most 72 UTF-8 bytes. Reject instead of silently truncating.
  if ([...value].length < 12 || Buffer.byteLength(value, 'utf8') > 72 || value.includes('\0')) {
    throw new BadRequestException({ code: 'INVALID_PASSWORD', message: 'Password must contain at least 12 characters and at most 72 UTF-8 bytes' });
  }
}
