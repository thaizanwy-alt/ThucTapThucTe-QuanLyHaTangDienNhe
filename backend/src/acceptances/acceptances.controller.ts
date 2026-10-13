import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user-role.enum';
import { ConfirmAcceptanceDto, CreateAcceptanceDto, ListAcceptancesDto, ReplacementAcceptanceDto, UpdateAcceptanceDto } from './acceptance.dto';
import { AcceptancesService } from './acceptances.service';

@Controller('projects/:projectId/acceptances')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.TECHNICIAN)
export class AcceptancesController {
  constructor(private readonly acceptances: AcceptancesService) {}
  @Get() list(@Param('projectId', ParseUUIDPipe) p: string, @Query() query: ListAcceptancesDto, @Req() req: AuthenticatedRequest) { return this.acceptances.list(p, query, req.user); }
  @Post() @Roles(UserRole.MANAGER)
  create(@Param('projectId', ParseUUIDPipe) p: string, @Body() dto: CreateAcceptanceDto, @Req() req: AuthenticatedRequest) { return this.acceptances.create(p, dto, req.user); }
  @Get(':id') get(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) { return this.acceptances.get(p, id, req.user); }
  @Patch(':id') @Roles(UserRole.MANAGER)
  update(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAcceptanceDto, @Req() req: AuthenticatedRequest) { return this.acceptances.update(p, id, dto, req.user); }
  @Get(':id/readiness') @Roles(UserRole.MANAGER)
  readiness(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest) { return this.acceptances.readiness(p, id, req.user); }
  @Post(':id/confirm') @HttpCode(200) @Roles(UserRole.MANAGER)
  confirm(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmAcceptanceDto, @Req() req: AuthenticatedRequest) { return this.acceptances.confirm(p, id, dto, req.user); }
  @Post(':id/replacement') @Roles(UserRole.MANAGER)
  replacement(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplacementAcceptanceDto, @Req() req: AuthenticatedRequest) { return this.acceptances.replacement(p, id, dto, req.user); }
  @Get(':id/files/:evidenceId/content') @Roles(UserRole.MANAGER)
  content(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Param('evidenceId', ParseUUIDPipe) e: string, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) { return this.file(p, id, e, req, res, false); }
  @Get(':id/files/:evidenceId/preview') @Roles(UserRole.MANAGER)
  preview(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Param('evidenceId', ParseUUIDPipe) e: string, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) { return this.file(p, id, e, req, res, true); }
  private async file(p: string, id: string, e: string, req: AuthenticatedRequest, res: Response, preview: boolean) {
    const file = await this.acceptances.file(p, id, e, req.user, preview);
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(file.handle.createReadStream(), { type: file.mimeType, length: file.size, disposition: `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}` });
  }
}
