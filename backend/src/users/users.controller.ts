import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from './user-role.enum';
import { User } from './user.entity';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class UsersController {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  @Get('technicians')
  listTechnicians(): Promise<Pick<User, 'id' | 'email'>[]> {
    return this.users.find({
      select: { id: true, email: true },
      where: { role: UserRole.TECHNICIAN, isActive: true },
      order: { email: 'ASC' },
    });
  }
}
