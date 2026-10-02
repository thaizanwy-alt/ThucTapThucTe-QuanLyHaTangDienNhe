import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user-role.enum';
import { CreateProjectTaskDto, ReturnProjectTaskDto, SubmitProjectTaskDto, UpdateProjectTaskDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

@Controller('projects/:projectId/tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.TECHNICIAN)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  listTasks(@Param('projectId', ParseUUIDPipe) projectId: string, @Req() request: AuthenticatedRequest) {
    return this.tasks.listTasks(projectId, request.user);
  }

  @Get(':taskId')
  getTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() request: AuthenticatedRequest,
  ) { return this.tasks.getTask(projectId, taskId, request.user); }

  @Post()
  @Roles(UserRole.MANAGER)
  createTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateProjectTaskDto,
    @Req() request: AuthenticatedRequest,
  ) { return this.tasks.createTask(projectId, dto, request.user); }

  @Patch(':taskId')
  @Roles(UserRole.MANAGER)
  updateTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateProjectTaskDto,
    @Req() request: AuthenticatedRequest,
  ) { return this.tasks.updateTask(projectId, taskId, dto, request.user); }

  @Post(':taskId/start')
  @Roles(UserRole.TECHNICIAN)
  @HttpCode(HttpStatus.OK)
  startTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() request: AuthenticatedRequest,
  ) { return this.tasks.startTask(projectId, taskId, request.user); }

  @Post(':taskId/submit')
  @Roles(UserRole.TECHNICIAN)
  @HttpCode(HttpStatus.OK)
  submitTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: SubmitProjectTaskDto,
    @Req() request: AuthenticatedRequest,
  ) { return this.tasks.submitTask(projectId, taskId, dto.completionNote, request.user); }

  @Post(':taskId/approve')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  approveTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() request: AuthenticatedRequest,
  ) { return this.tasks.approveTask(projectId, taskId, request.user); }

  @Post(':taskId/return')
  @Roles(UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  returnTask(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: ReturnProjectTaskDto,
    @Req() request: AuthenticatedRequest,
  ) { return this.tasks.returnTask(projectId, taskId, dto.reason, request.user); }
}
