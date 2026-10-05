import { Body, Controller, Delete, HttpCode, HttpStatus, Get, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user-role.enum';
import { CreateProjectDeviceDto, UpdateProjectDeviceDto } from './dto/device.dto';
import { PutDeviceNetworkProfileDto } from './dto/network-profile.dto';
import { DevicesService } from './devices.service';

@Controller('projects/:projectId/devices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.TECHNICIAN)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  listDevices(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.devices.listDevices(projectId);
  }

  @Get(':deviceId')
  getDevice(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('deviceId', ParseUUIDPipe) deviceId: string) {
    return this.devices.getDevice(projectId, deviceId);
  }

  @Get(':deviceId/network-profile')
  async getNetworkProfile(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Res() response: Response) {
    return response.status(HttpStatus.OK).json(await this.devices.getNetworkProfile(projectId, deviceId));
  }

  @Put(':deviceId/network-profile')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  putNetworkProfile(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: PutDeviceNetworkProfileDto, @Req() request: AuthenticatedRequest) {
    return this.devices.putNetworkProfile(projectId, deviceId, dto, request.user);
  }

  @Post()
  @Roles(UserRole.MANAGER)
  createDevice(@Param('projectId', ParseUUIDPipe) projectId: string, @Body() dto: CreateProjectDeviceDto, @Req() request: AuthenticatedRequest) {
    return this.devices.createDevice(projectId, dto, request.user);
  }

  @Patch(':deviceId')
  @Roles(UserRole.MANAGER)
  updateDevice(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('deviceId', ParseUUIDPipe) deviceId: string, @Body() dto: UpdateProjectDeviceDto, @Req() request: AuthenticatedRequest) {
    return this.devices.updateDevice(projectId, deviceId, dto, request.user);
  }

  @Delete(':deviceId')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDevice(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('deviceId', ParseUUIDPipe) deviceId: string, @Req() request: AuthenticatedRequest) {
    return this.devices.deleteDevice(projectId, deviceId, request.user);
  }
}
