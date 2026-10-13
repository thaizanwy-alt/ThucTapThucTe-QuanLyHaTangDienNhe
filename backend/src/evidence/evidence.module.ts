import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EvidenceAttachment } from './evidence.entity';
import { EvidenceService } from './evidence.service';
import { EvidenceStorage } from './evidence.storage';
import { EvidenceController, TargetEvidenceController } from './evidence.controller';

@Module({ imports: [AuthModule, TypeOrmModule.forFeature([EvidenceAttachment])],
  controllers: [TargetEvidenceController, EvidenceController], providers: [EvidenceStorage, EvidenceService] })
export class EvidenceModule {}
