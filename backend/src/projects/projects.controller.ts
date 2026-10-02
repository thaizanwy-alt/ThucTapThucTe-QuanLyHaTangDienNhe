import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user-role.enum';
import { CreateAreaDto, UpdateAreaDto } from './dto/area.dto';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { CreateProjectSystemDto, UpdateProjectSystemDto } from './dto/system.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.TECHNICIAN)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  listProjects() { return this.projects.listProjects(); }

  @Post()
  @Roles(UserRole.MANAGER)
  createProject(@Body() dto: CreateProjectDto) { return this.projects.createProject(dto); }

  @Get(':id')
  getProject(@Param('id', ParseUUIDPipe) id: string) { return this.projects.getProject(id); }

  @Patch(':id')
  @Roles(UserRole.MANAGER)
  updateProject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.updateProject(id, dto);
  }

  @Get(':id/areas')
  listAreas(@Param('id', ParseUUIDPipe) id: string) { return this.projects.listAreas(id); }

  @Post(':id/areas')
  @Roles(UserRole.MANAGER)
  createArea(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateAreaDto) {
    return this.projects.createArea(id, dto);
  }

  @Patch(':id/areas/:areaId')
  @Roles(UserRole.MANAGER)
  updateArea(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
    @Body() dto: UpdateAreaDto,
  ) { return this.projects.updateArea(id, areaId, dto); }

  @Delete(':id/areas/:areaId')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteArea(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('areaId', ParseUUIDPipe) areaId: string,
  ) { return this.projects.deleteArea(id, areaId); }

  @Get(':id/systems')
  listSystems(@Param('id', ParseUUIDPipe) id: string) { return this.projects.listSystems(id); }

  @Post(':id/systems')
  @Roles(UserRole.MANAGER)
  createSystem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateProjectSystemDto) {
    return this.projects.createSystem(id, dto);
  }

  @Patch(':id/systems/:systemId')
  @Roles(UserRole.MANAGER)
  updateSystem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('systemId', ParseUUIDPipe) systemId: string,
    @Body() dto: UpdateProjectSystemDto,
  ) { return this.projects.updateSystem(id, systemId, dto); }

  @Delete(':id/systems/:systemId')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteSystem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('systemId', ParseUUIDPipe) systemId: string,
  ) { return this.projects.deleteSystem(id, systemId); }
}
