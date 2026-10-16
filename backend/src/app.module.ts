import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';
import { DevicesModule } from './devices/devices.module';
import { ConnectionsModule } from './connections/connections.module';
import { RacksModule } from './devices/racks.module';
import { InspectionsModule } from './inspections/inspections.module';
import { EvidenceModule } from './evidence/evidence.module';
import { AcceptancesModule } from './acceptances/acceptances.module';
import { ExportsModule } from './exports/exports.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', 'backend/.env'] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: Number(config.get<string>('DB_PORT', '5432')),
        username: config.get<string>('DB_USER', 'postgres'),
        password: config.get<string>('DB_PASSWORD', ''),
        database: config.get<string>('DB_NAME', 'electrical_infrastructure'),
        uuidExtension: 'pgcrypto',
        installExtensions: false,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    AuthModule,
    ProjectsModule,
    TasksModule,
    UsersModule,
    DevicesModule,
    ConnectionsModule,
    RacksModule,
    InspectionsModule,
    EvidenceModule,
    AcceptancesModule,
    ExportsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
