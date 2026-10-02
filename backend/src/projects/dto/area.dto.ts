import { Transform } from 'class-transformer';
import { IsDefined, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Min, ValidateIf } from 'class-validator';
import { AreaType } from '../area-type.enum';
import { normalizeCode, trimText } from './dto.transforms';

const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export class CreateAreaDto {
  @Transform(normalizeCode)
  @IsString()
  @Matches(CODE_PATTERN)
  code!: string;

  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEnum(AreaType)
  type!: AreaType;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateAreaDto {
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
  @IsUUID()
  parentId?: string | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
