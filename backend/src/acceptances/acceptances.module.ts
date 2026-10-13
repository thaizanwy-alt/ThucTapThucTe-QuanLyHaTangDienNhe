import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { AcceptanceEvidence, AcceptanceInspection, AcceptanceSnapshot, ProjectAcceptance } from './acceptance.entities';
import { AcceptancesService } from './acceptances.service';
import { AcceptancesController } from './acceptances.controller';

@Module({ imports: [AuthModule, EvidenceModule, TypeOrmModule.forFeature([ProjectAcceptance, AcceptanceInspection, AcceptanceEvidence, AcceptanceSnapshot])],
  providers: [AcceptancesService], controllers: [AcceptancesController] })
export class AcceptancesModule {}
