import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { AccessTokenPayload, AuthenticatedUser } from './auth.types';
import { PASSWORD_CHANGE_ALLOWED } from './password-change-allowed.decorator';

export type AuthenticatedRequest = Request & { user: AuthenticatedUser; authVersion: number };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
      if (typeof payload.sub !== 'string' || !Number.isInteger(payload.authVersion) || payload.authVersion < 0) {
        throw new UnauthorizedException();
      }
      const user = await this.auth.findActiveUser(payload.sub, payload.authVersion);
      if (!user) throw new UnauthorizedException();
      request.user = user;
      request.authVersion = payload.authVersion;
    } catch {
      throw new UnauthorizedException();
    }
    const allowed = this.reflector.getAllAndOverride<boolean>(PASSWORD_CHANGE_ALLOWED, [
      context.getHandler(), context.getClass(),
    ]) === true;
    if (request.user.mustChangePassword && !allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Change your temporary password before continuing',
      });
    }
    return true;
  }
}
