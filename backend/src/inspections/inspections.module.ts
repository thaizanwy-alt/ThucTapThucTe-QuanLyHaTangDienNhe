import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChecklistTemplate, ChecklistTemplateItem, InspectionItem, ProjectInspection, RemediationIssue } from './inspection.entities';
import { ChecklistTemplatesController, InspectionsController, IssuesController } from './inspections.controller';
import { InspectionsService } from './inspections.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([ChecklistTemplate, ChecklistTemplateItem, ProjectInspection, InspectionItem, RemediationIssue])],
  controllers: [ChecklistTemplatesController, InspectionsController, IssuesController],
  providers: [InspectionsService],
})
export class InspectionsModule {}
