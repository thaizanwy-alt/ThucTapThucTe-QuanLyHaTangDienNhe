import { ArrayUnique, IsArray, IsDefined, IsEnum, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { MountMode, RackRole } from '../rack-layout.enums';

export class UpdateRackDto {
  @IsOptional()
  @IsEnum(RackRole)
  rackRole?: RackRole | null;

  @IsOptional()
  @IsUUID()
  parentRackId?: string | null;

  @IsOptional()
  @IsUUID()
  areaId?: string | null;

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
  servedAreaIds?: string[];
}

export class PutPlacementDto {
  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsUUID()
  areaId!: string | null;

  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsUUID()
  rackId!: string | null;

  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsEnum(MountMode)
  mountMode!: MountMode | null;

  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(2147483647)
  startU!: number | null;

  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  heightU!: number | null;
}
