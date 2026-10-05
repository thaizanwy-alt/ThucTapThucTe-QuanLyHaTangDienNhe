import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Project } from '../projects/project.entity';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectDevice } from '../devices/project-device.entity';
import { DevicePort } from './device-port.entity';
import { PhysicalConnection } from './physical-connection.entity';
import { ConnectionEndpoint } from './connection-endpoint.entity';
import { ConnectionsController } from './connections.controller';
import { ConnectionsService } from './connections.service';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Project, ProjectArea, ProjectDevice, DevicePort, PhysicalConnection, ConnectionEndpoint])],
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
})
export class ConnectionsModule {}
