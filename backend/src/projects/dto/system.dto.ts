import { Transform } from 'class-transformer';
import { IsDefined, IsEnum, IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { SystemCategory } from '../system-category.enum';
import { normalizeCode, trimText } from './dto.transforms';

const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export class CreateProjectSystemDto {
  @Transform(normalizeCode)
  @IsString()
  @Matches(CODE_PATTERN)
  code!: string;

  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(SystemCategory)
  category!: SystemCategory;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class UpdateProjectSystemDto {
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

  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined()
  @IsEnum(SystemCategory)
  category?: SystemCategory;

  @IsOptional()
  @IsString()
  description?: string | null;
}
