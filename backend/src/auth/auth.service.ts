import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AccessTokenPayload, AuthenticatedUser } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
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

    const payload: AccessTokenPayload = { sub: user.id };
    return { accessToken: await this.jwt.signAsync(payload) };
  }

  async findActiveUser(id: string): Promise<AuthenticatedUser | null> {
    const user = await this.users.findOneBy({ id, isActive: true });
    if (!user) return null;
    return { id: user.id, email: user.email, role: user.role, isActive: user.isActive };
  }
}
