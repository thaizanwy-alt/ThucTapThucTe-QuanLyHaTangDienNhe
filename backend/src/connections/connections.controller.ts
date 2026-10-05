import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/user-role.enum';
import { ConnectionsService } from './connections.service';
import { ConnectionsQueryDto, CreateConnectionDto, CreatePortDto, RewireDto, TraceQueryDto, UpdatePortDto } from './dto/connection.dto';

@Controller('projects/:projectId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.TECHNICIAN)
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}
  @Get('devices/:deviceId/ports')
  listPorts(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('deviceId', ParseUUIDPipe) deviceId: string) {
    return this.connections.listPorts(projectId, deviceId);
  }
  @Post('devices/:deviceId/ports')
  @Roles(UserRole.MANAGER)
  createPort(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: CreatePortDto, @Req() req: AuthenticatedRequest) {
    return this.connections.createPort(projectId, deviceId, dto, req.user);
  }
  @Patch('devices/:deviceId/ports/:portId')
  @Roles(UserRole.MANAGER)
  updatePort(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Param('portId', ParseUUIDPipe) portId: string, @Body() dto: UpdatePortDto, @Req() req: AuthenticatedRequest) {
    return this.connections.updatePort(projectId, deviceId, portId, dto, req.user);
  }
  @Delete('devices/:deviceId/ports/:portId')
  @Roles(UserRole.MANAGER)
  @HttpCode(204)
  deletePort(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Param('portId', ParseUUIDPipe) portId: string, @Req() req: AuthenticatedRequest) {
    return this.connections.deletePort(projectId, deviceId, portId, req.user);
  }
  @Get('connections')
  listConnections(@Param('projectId', ParseUUIDPipe) projectId: string, @Query() query: ConnectionsQueryDto) {
    return this.connections.listConnections(projectId, query.deviceId);
  }
  @Get('connections/trace')
  trace(@Param('projectId', ParseUUIDPipe) projectId: string, @Query() query: TraceQueryDto) {
    return this.connections.trace(projectId, query.deviceCode);
  }
  @Post('connections')
  @Roles(UserRole.MANAGER)
  createConnection(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: CreateConnectionDto, @Req() req: AuthenticatedRequest) {
    return this.connections.createConnection(projectId, dto, req.user);
  }
  @Post('connections/:connectionId/rewire')
  @Roles(UserRole.MANAGER)
  @HttpCode(200)
  rewire(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('connectionId', ParseUUIDPipe) connectionId: string,
    @Body() dto: RewireDto, @Req() req: AuthenticatedRequest) {
    return this.connections.rewire(projectId, connectionId, dto, req.user);
  }
  @Delete('connections/:connectionId')
  @Roles(UserRole.MANAGER)
  @HttpCode(204)
  deleteConnection(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('connectionId', ParseUUIDPipe) connectionId: string, @Req() req: AuthenticatedRequest) {
    return this.connections.deleteConnection(projectId, connectionId, req.user);
  }
}
