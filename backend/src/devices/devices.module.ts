import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectSystem } from '../projects/project-system.entity';
import { Project } from '../projects/project.entity';
import { ProjectDevice } from './project-device.entity';
import { ProjectDeviceSystem } from './project-device-system.entity';
import { DeviceNetworkProfile } from './device-network-profile.entity';
import { DevicePort } from '../connections/device-port.entity';
import { RackServedArea } from './rack-served-area.entity';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectDevice, ProjectDeviceSystem, RackServedArea, DeviceNetworkProfile, DevicePort, Project, ProjectArea, ProjectSystem]), AuthModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
