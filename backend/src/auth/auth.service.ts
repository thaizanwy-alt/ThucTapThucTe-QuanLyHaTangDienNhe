import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { DataSource } from 'typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AccessTokenPayload, AuthenticatedUser } from './auth.types';
import { validatePassword } from './password-policy';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly db: DataSource,
  ) {}

  async login(email: string, password: string): Promise<{ accessToken: string }> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: normalizedEmail })
      .getOne();

    if (!user || !user.isActive || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: AccessTokenPayload = { sub: user.id, authVersion: user.authVersion };
    return { accessToken: await this.jwt.signAsync(payload) };
  }

  async findActiveUser(id: string, authVersion: number): Promise<AuthenticatedUser | null> {
    const user = await this.users.findOneBy({ id, isActive: true });
    if (!user || user.authVersion !== authVersion) return null;
    return {
      id: user.id, email: user.email, role: user.role, isActive: user.isActive,
      mustChangePassword: user.mustChangePassword, version: user.version,
    };
  }

  async changePassword(
    id: string,
    tokenAuthVersion: number,
    expectedVersion: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    validatePassword(newPassword);
    await this.db.transaction(async manager => {
      const user = await manager.createQueryBuilder(User, 'user')
        .addSelect('user.passwordHash')
        .setLock('pessimistic_write')
        .where('user.id = :id', { id })
        .getOne();
      if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');
      if (user.authVersion !== tokenAuthVersion) throw new UnauthorizedException('Session is no longer valid');
      if (user.version !== expectedVersion) throw new ConflictException({ code: 'ACCOUNT_VERSION_CONFLICT', message: 'Account changed; sign in again' });
      if (!(await compare(currentPassword, user.passwordHash))) throw new UnauthorizedException('Invalid credentials');
      if (await compare(newPassword, user.passwordHash)) throw new ConflictException({ code: 'PASSWORD_UNCHANGED', message: 'Choose a different password' });
      user.passwordHash = await hash(newPassword, 12);
      user.mustChangePassword = false;
      user.authVersion++;
      user.version++;
      await manager.save(user);
    });
  }
}
