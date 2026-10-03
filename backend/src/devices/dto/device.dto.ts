import { Transform } from 'class-transformer';
import { ArrayUnique, Equals, IsArray, IsDefined, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateIf } from 'class-validator';
import { normalizeCode, trimText } from '../../projects/dto/dto.transforms';
import { DeviceType } from '../device-type.enum';

const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

class DeviceFieldsDto {
  @IsOptional()
  @Transform(trimText)
  @IsString()
  brand?: string | null;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  model?: string | null;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  serialNumber?: string | null;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  description?: string | null;

  @IsOptional()
  @Transform(trimText)
  @IsString()
  locationNote?: string | null;

  @IsOptional()
  @IsUUID()
  areaId?: string | null;

  @IsOptional()
  @IsUUID()
  rackId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  capacityU?: number | null;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDefined()
  @IsArray()
  @ArrayUnique((value: unknown) => typeof value === 'string' ? value.toLowerCase() : value)
  @IsUUID(undefined, { each: true })
  systemIds?: string[];
}

export class CreateProjectDeviceDto extends DeviceFieldsDto {
  @IsEnum(DeviceType)
  type!: DeviceType;

  @Transform(normalizeCode)
  @IsString()
  @Matches(CODE_PATTERN)
  code!: string;

  @Transform(trimText)
  @IsString()
  @IsNotEmpty()
  name!: string;
}

export class UpdateProjectDeviceDto extends DeviceFieldsDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Equals(undefined, { message: 'type cannot be changed' })
  type?: never;

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
  name?: string;
}
