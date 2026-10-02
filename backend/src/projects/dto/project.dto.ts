import { Transform } from 'class-transformer';
import { IsDefined, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { ProjectStatus } from '../project-status.enum';
import { normalizeCode, trimText } from './dto.transforms';

const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export class CreateProjectDto {
  @Transform(normalizeCode)
  @IsString()
  @Matches(CODE_PATTERN)
  code!: string;

  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  address?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class UpdateProjectDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(normalizeCode)
  @IsString()
  @Matches(CODE_PATTERN)
  code?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsString()
  description?: string | null;
}
