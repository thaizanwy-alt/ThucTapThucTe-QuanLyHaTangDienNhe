import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user-role.enum';
import { PutPlacementDto, UpdateRackDto } from './dto/rack-layout.dto';
import { RacksService } from './racks.service';

@Controller('projects/:projectId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.TECHNICIAN)
export class RacksController {
  constructor(private readonly racks: RacksService) {}

  @Get('racks')
  list(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.racks.listRacks(projectId);
  }

  @Get('racks/:rackId/layout')
  layout(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('rackId', ParseUUIDPipe) rackId: string) {
    return this.racks.getLayout(projectId, rackId);
  }

  @Patch('racks/:rackId')
  @Roles(UserRole.MANAGER)
  update(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('rackId', ParseUUIDPipe) rackId: string,
    @Body() dto: UpdateRackDto, @Req() request: AuthenticatedRequest) {
    return this.racks.updateRack(projectId, rackId, dto, request.user);
  }

  @Put('devices/:deviceId/placement')
  @Roles(UserRole.MANAGER)
  place(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: PutPlacementDto, @Req() request: AuthenticatedRequest) {
    return this.racks.putPlacement(projectId, deviceId, dto, request.user);
  }
}
