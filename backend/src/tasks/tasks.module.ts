import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ProjectArea } from '../projects/project-area.entity';
import { ProjectSystem } from '../projects/project-system.entity';
import { Project } from '../projects/project.entity';
import { User } from '../users/user.entity';
import { ProjectTask } from './project-task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectTask, Project, ProjectSystem, ProjectArea, User]), AuthModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
