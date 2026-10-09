import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user-role.enum';
import { SystemCategory } from '../projects/system-category.enum';
import { AssignIssueDto, CreateInspectionDto, PutInspectionResultDto, RecheckIssueDto, ResolveIssueDto, VersionDto } from './dto/inspection.dto';
import { InspectionsService } from './inspections.service';

@Controller('checklist-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ChecklistTemplatesController {
  constructor(private readonly inspections: InspectionsService) {}
  @Get()
  list(@Query('category') category: SystemCategory | undefined, @Req() req: AuthenticatedRequest) {
    return this.inspections.listTemplates(category, req.user);
  }
}

@Controller('projects/:projectId/inspections')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}
  @Get()
  list(@Param('projectId', ParseUUIDPipe) p: string, @Req() req: AuthenticatedRequest) {
    return this.inspections.listInspections(p, req.user);
  }
  @Post()
  create(@Param('projectId', ParseUUIDPipe) p: string, @Body() dto: CreateInspectionDto, @Req() req: AuthenticatedRequest) {
    return this.inspections.createInspection(p, dto, req.user);
  }
  @Get(':inspectionId')
  get(@Param('projectId', ParseUUIDPipe) p: string, @Param('inspectionId', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.inspections.getInspection(p, id, req.user);
  }
  @Put(':inspectionId/items/:itemId/result')
  result(@Param('projectId', ParseUUIDPipe) p: string, @Param('inspectionId', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) item: string, @Body() dto: PutInspectionResultDto, @Req() req: AuthenticatedRequest) {
    return this.inspections.putResult(p, id, item, dto, req.user);
  }
}

@Controller('projects/:projectId/issues')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.TECHNICIAN)
export class IssuesController {
  constructor(private readonly inspections: InspectionsService) {}
  @Get()
  list(@Param('projectId', ParseUUIDPipe) p: string, @Req() req: AuthenticatedRequest) {
    return this.inspections.listIssues(p, req.user);
  }
  @Get(':issueId')
  get(@Param('projectId', ParseUUIDPipe) p: string, @Param('issueId', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) {
    return this.inspections.getIssue(p, id, req.user);
  }
  @Patch(':issueId/assignee')
  @Roles(UserRole.MANAGER)
  assign(@Param('projectId', ParseUUIDPipe) p: string, @Param('issueId', ParseUUIDPipe) id: string,
    @Body() dto: AssignIssueDto, @Req() req: AuthenticatedRequest) {
    return this.inspections.assignIssue(p, id, dto, req.user);
  }
  @Post(':issueId/start')
  @Roles(UserRole.TECHNICIAN)
  @HttpCode(200)
  start(@Param('projectId', ParseUUIDPipe) p: string, @Param('issueId', ParseUUIDPipe) id: string,
    @Body() dto: VersionDto, @Req() req: AuthenticatedRequest) {
    return this.inspections.startIssue(p, id, dto, req.user);
  }
  @Post(':issueId/resolve')
  @Roles(UserRole.TECHNICIAN)
  @HttpCode(200)
  resolve(@Param('projectId', ParseUUIDPipe) p: string, @Param('issueId', ParseUUIDPipe) id: string,
    @Body() dto: ResolveIssueDto, @Req() req: AuthenticatedRequest) {
    return this.inspections.resolveIssue(p, id, dto, req.user);
  }
  @Post(':issueId/recheck')
  @Roles(UserRole.MANAGER)
  @HttpCode(200)
  recheck(@Param('projectId', ParseUUIDPipe) p: string, @Param('issueId', ParseUUIDPipe) id: string,
    @Body() dto: RecheckIssueDto, @Req() req: AuthenticatedRequest) {
    return this.inspections.recheckIssue(p, id, dto, req.user);
  }
}
