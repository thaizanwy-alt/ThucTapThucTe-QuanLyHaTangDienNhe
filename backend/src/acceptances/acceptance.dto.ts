import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsDefined, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { normalizeCode, trimText } from '../projects/dto/dto.transforms';
import { VersionDto } from '../inspections/dto/inspection.dto';
import { AcceptanceStatus } from './acceptance.entities';

export class CreateAcceptanceDto {
  @Transform(normalizeCode) @IsDefined() @IsString() @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/) @MaxLength(100) code!: string;
  @Transform(trimText) @IsDefined() @IsString() @IsNotEmpty() @MaxLength(255) title!: string;
  @IsDefined() @IsUUID() systemId!: string;
  @IsOptional() @Transform(trimText) @IsString() @MaxLength(2000) note?: string | null;
  @IsDefined() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) inspectionIds!: string[];
  @IsDefined() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) evidenceIds!: string[];
}

export class UpdateAcceptanceDto extends VersionDto {
  @ValidateIf((_o, v) => v !== undefined) @IsDefined() @Transform(normalizeCode) @IsString() @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/) @MaxLength(100) code?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsDefined() @Transform(trimText) @IsString() @IsNotEmpty() @MaxLength(255) title?: string;
  @IsOptional() @Transform(trimText) @IsString() @MaxLength(2000) note?: string | null;
  @ValidateIf((_o, v) => v !== undefined) @IsDefined() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) inspectionIds?: string[];
  @ValidateIf((_o, v) => v !== undefined) @IsDefined() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) evidenceIds?: string[];
}

export class ConfirmAcceptanceDto extends VersionDto {
  @IsDefined() @IsString() @Matches(/^[a-f0-9]{64}$/) expectedSourceFingerprint!: string;
}
export class ReplacementAcceptanceDto {
  @Transform(normalizeCode) @IsDefined() @IsString() @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/) @MaxLength(100) code!: string;
  @Transform(trimText) @IsDefined() @IsString() @IsNotEmpty() @MaxLength(255) title!: string;
  @Transform(trimText) @IsDefined() @IsString() @IsNotEmpty() @MaxLength(2000) reason!: string;
  @IsDefined() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) inspectionIds!: string[];
  @IsDefined() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) evidenceIds!: string[];
}
export class ListAcceptancesDto {
  @ValidateIf((_o, v) => v !== undefined) @IsDefined() @IsUUID() systemId?: string;
  @ValidateIf((_o, v) => v !== undefined) @IsDefined() @IsEnum(AcceptanceStatus) status?: AcceptanceStatus;
}
