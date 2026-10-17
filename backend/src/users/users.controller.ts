import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from './user-role.enum';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { CreateTechnicianDto, ResetTechnicianPasswordDto, UpdateTechnicianStatusDto } from './dto/user-management.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class UsersController {
  constructor(@InjectRepository(User) private readonly users: Repository<User>, private readonly service: UsersService) {}

  @Get('technicians')
  listTechnicians(): Promise<Pick<User, 'id' | 'email'>[]> {
    return this.users.find({
      select: { id: true, email: true },
      where: { role: UserRole.TECHNICIAN, isActive: true },
      order: { email: 'ASC' },
    });
  }

  @Get('technicians/manage')
  listManagedTechnicians() { return this.service.listManagedTechnicians(); }

  @Post('technicians')
  createTechnician(@Body() dto: CreateTechnicianDto) { return this.service.createTechnician(dto); }

  @Patch('technicians/:id/status')
  updateTechnicianStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTechnicianStatusDto) {
    return this.service.updateTechnicianStatus(id, dto);
  }

  @Post('technicians/:id/password-reset')
  resetTechnicianPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetTechnicianPasswordDto) {
    return this.service.resetTechnicianPassword(id, dto);
  }
}
