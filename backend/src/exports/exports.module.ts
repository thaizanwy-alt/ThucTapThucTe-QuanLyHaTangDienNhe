import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({ imports: [AuthModule, EvidenceModule], providers: [ExportsService], controllers: [ExportsController] })
export class ExportsModule {}
