import { Transform } from 'class-transformer';
import { IsDefined, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, ValidateIf } from 'class-validator';
import { normalizeCode, trimText } from '../../projects/dto/dto.transforms';

const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export class CreateProjectTaskDto {
  @Transform(normalizeCode)
  @IsString()
  @Matches(CODE_PATTERN)
  code!: string;

  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsUUID()
  systemId!: string;

  @IsOptional()
  @IsUUID()
  areaId?: string | null;

  @IsUUID()
  assigneeId!: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class UpdateProjectTaskDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(normalizeCode)
  @IsDefined()
  @IsString()
  @Matches(CODE_PATTERN)
  code?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimText)
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined()
  @IsUUID()
  systemId?: string;

  @IsOptional()
  @IsUUID()
  areaId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class SubmitProjectTaskDto {
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  completionNote!: string;
}

export class ReturnProjectTaskDto {
  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
