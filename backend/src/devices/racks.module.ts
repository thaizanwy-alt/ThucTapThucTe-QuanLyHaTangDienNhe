import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Project } from '../projects/project.entity';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectDevice } from './project-device.entity';
import { ProjectDeviceSystem } from './project-device-system.entity';
import { RackServedArea } from './rack-served-area.entity';
import { RacksController } from './racks.controller';
import { RacksService } from './racks.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectArea, ProjectDevice, ProjectDeviceSystem, RackServedArea]), AuthModule],
  controllers: [RacksController],
  providers: [RacksService],
})
export class RacksModule {}
