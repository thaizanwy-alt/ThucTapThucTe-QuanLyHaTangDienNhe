import 'reflect-metadata';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectSystem } from '../projects/project-system.entity';
import { CreateUsers1790000000000 } from './migrations/1790000000000-CreateUsers';
import { CreateProjectStructure1791000000000 } from './migrations/1791000000000-CreateProjectStructure';

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
  entities: [User, Project, ProjectArea, ProjectSystem],
  migrations: [CreateUsers1790000000000, CreateProjectStructure1791000000000],
  synchronize: false,
});
