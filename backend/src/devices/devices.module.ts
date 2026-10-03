import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectSystem } from '../projects/project-system.entity';
import { Project } from '../projects/project.entity';
import { ProjectDevice } from './project-device.entity';
import { ProjectDeviceSystem } from './project-device-system.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectDevice, ProjectDeviceSystem, Project, ProjectArea, ProjectSystem]), AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
