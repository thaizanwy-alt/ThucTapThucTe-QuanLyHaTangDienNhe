import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, Res, StreamableFile, UseGuards, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { isUUID } from 'class-validator';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../users/user-role.enum';
import { EvidenceService, EvidenceTarget } from './evidence.service';
import { EvidenceStorage, idempotencyKeyOf } from './evidence.storage';
import { DeleteEvidenceDto, UpdateEvidenceDto } from './evidence.dto';

function target(req: AuthenticatedRequest): EvidenceTarget {
  const { taskId, itemId, issueId, inspectionId } = req.params;
  if (Object.values(req.params).some(value => typeof value !== 'string' || !isUUID(value))) throw new BadRequestException('Invalid resource UUID');
  return { taskId: taskId as string, inspectionItemId: itemId as string, issueId: issueId as string, inspectionId: inspectionId as string };
}
@Controller(['projects/:projectId/tasks/:taskId/evidence', 'projects/:projectId/inspections/:inspectionId/items/:itemId/evidence', 'projects/:projectId/issues/:issueId/evidence'])
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.TECHNICIAN)
export class TargetEvidenceController {
  constructor(private readonly evidence: EvidenceService, private readonly storage: EvidenceStorage) {}
  @Get()
  list(@Param('projectId', ParseUUIDPipe) projectId: string, @Req() req: AuthenticatedRequest) {
    return this.evidence.list(projectId, target(req), req.user);
  }
  @Post()
  async upload(@Param('projectId', ParseUUIDPipe) projectId: string, @Req() req: AuthenticatedRequest) {
    const t = target(req); const key = idempotencyKeyOf(req.headers['idempotency-key']);
    await this.evidence.authorize(projectId, t, req.user);
    const file = await this.storage.receive(req);
    return this.evidence.upload(projectId, t, req.user, key, file);
  }
}

@Controller('projects/:projectId/evidence')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER, UserRole.TECHNICIAN)
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}
  @Patch(':id')
  update(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEvidenceDto, @Req() req: AuthenticatedRequest) {
    return this.evidence.update(p, id, dto, req.user);
  }
  @Delete(':id') @HttpCode(204)
  remove(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeleteEvidenceDto, @Req() req: AuthenticatedRequest) {
    return this.evidence.remove(p, id, dto, req.user);
  }
  @Get(':id/content')
  download(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.file(p, id, req, res, false);
  }
  @Get(':id/preview')
  preview(@Param('projectId', ParseUUIDPipe) p: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response) {
    return this.file(p, id, req, res, true);
  }
  private async file(p: string, id: string, req: AuthenticatedRequest, res: Response, preview: boolean) {
    const file = await this.evidence.content(p, id, req.user, preview);
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(file.handle.createReadStream(), { type: file.mimeType, length: file.size,
      disposition: `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}` });
  }
}
