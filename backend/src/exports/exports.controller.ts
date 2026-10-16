import { Controller, Get, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UserRole } from '../users/user-role.enum';
import { ExportsService } from './exports.service';
import type { PreparedExport } from './exports.render';

@Controller('projects/:projectId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.MANAGER)
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('acceptances/:id/export.pdf')
  async pdf(@Param('projectId', ParseUUIDPipe) projectId: string, @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest, @Res() res: Response) {
    return this.send(await this.exports.acceptancePdf(projectId, id, req.user), res);
  }

  @Get('exports/devices.xlsx')
  async devices(@Param('projectId', ParseUUIDPipe) projectId: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    return this.send(await this.exports.devicesWorkbook(projectId, req.user), res);
  }

  @Get('exports/connections.xlsx')
  async connections(@Param('projectId', ParseUUIDPipe) projectId: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    return this.send(await this.exports.connectionsWorkbook(projectId, req.user), res);
  }

  private async send(file: PreparedExport, res: Response): Promise<void> {
    try {
      res.setHeader('Content-Type', file.mime);
      res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
      res.setHeader('Content-Length', file.size);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      await pipeline(createReadStream(file.path), res);
    } finally { await file.cleanup(); }
  }
}
