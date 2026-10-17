import 'reflect-metadata';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectSystem } from '../projects/project-system.entity';
import { ProjectTask } from '../tasks/project-task.entity';
import { ProjectDevice } from '../devices/project-device.entity';
import { ProjectDeviceSystem } from '../devices/project-device-system.entity';
import { RackServedArea } from '../devices/rack-served-area.entity';
import { DeviceNetworkProfile } from '../devices/device-network-profile.entity';
import { DevicePort } from '../connections/device-port.entity';
import { PhysicalConnection } from '../connections/physical-connection.entity';
import { ConnectionEndpoint } from '../connections/connection-endpoint.entity';
import { CreateDeviceConnections1794000000000 } from './migrations/1794000000000-CreateDeviceConnections';
import { EnforceConnectionEndpointPair1795000000000 } from './migrations/1795000000000-EnforceConnectionEndpointPair';
import { AddDeviceNetworkProfileAndPortMetadata1796000000000 } from './migrations/1796000000000-AddDeviceNetworkProfileAndPortMetadata';
import { CreateUsers1790000000000 } from './migrations/1790000000000-CreateUsers';
import { CreateProjectStructure1791000000000 } from './migrations/1791000000000-CreateProjectStructure';
import { CreateProjectTasks1792000000000 } from './migrations/1792000000000-CreateProjectTasks';
import { CreateProjectDevices1793000000000 } from './migrations/1793000000000-CreateProjectDevices';
import { AddRackLayout1797000000000 } from './migrations/1797000000000-AddRackLayout';
import { EnforceRackLayoutIntegrity1798000000000 } from './migrations/1798000000000-EnforceRackLayoutIntegrity';
import { EnforceRackServedAreaForeignKey1799000000000 } from './migrations/1799000000000-EnforceRackServedAreaForeignKey';
import { ChecklistTemplate, ChecklistTemplateItem, ProjectInspection, InspectionItem, RemediationIssue } from '../inspections/inspection.entities';
import { CreateInspections1800000000000 } from './migrations/1800000000000-CreateInspections';
import { EvidenceAttachment } from '../evidence/evidence.entity';
import { CreateEvidenceAttachments1801000000000 } from './migrations/1801000000000-CreateEvidenceAttachments';
import { AcceptanceEvidence, AcceptanceInspection, AcceptanceSnapshot, ProjectAcceptance } from '../acceptances/acceptance.entities';
import { CreateProjectAcceptances1802000000000 } from './migrations/1802000000000-CreateProjectAcceptances';
import { AddUserAccountSecurity1803000000000 } from './migrations/1803000000000-AddUserAccountSecurity';

config({ path: resolve(__dirname, '../../.env') });

export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? '5432'),
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'electrical_infrastructure',
  uuidExtension: 'pgcrypto',
  installExtensions: false,
  entities: [User, Project, ProjectArea, ProjectSystem, ProjectTask, ProjectDevice, ProjectDeviceSystem, RackServedArea, DeviceNetworkProfile, DevicePort, PhysicalConnection, ConnectionEndpoint, ChecklistTemplate, ChecklistTemplateItem, ProjectInspection, InspectionItem, RemediationIssue, EvidenceAttachment, ProjectAcceptance, AcceptanceInspection, AcceptanceEvidence, AcceptanceSnapshot],
  migrations: [CreateUsers1790000000000, CreateProjectStructure1791000000000, CreateProjectTasks1792000000000, CreateProjectDevices1793000000000, CreateDeviceConnections1794000000000, EnforceConnectionEndpointPair1795000000000, AddDeviceNetworkProfileAndPortMetadata1796000000000, AddRackLayout1797000000000, EnforceRackLayoutIntegrity1798000000000, EnforceRackServedAreaForeignKey1799000000000, CreateInspections1800000000000, CreateEvidenceAttachments1801000000000, CreateProjectAcceptances1802000000000, AddUserAccountSecurity1803000000000],
  synchronize: false,
});
