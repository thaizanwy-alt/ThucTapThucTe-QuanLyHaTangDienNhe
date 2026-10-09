import { Type, Transform } from 'class-transformer';
import { IsDefined, IsEnum, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { normalizeCode, trimText } from '../../projects/dto/dto.transforms';
import { InspectionResult } from '../inspection.enums';

export class VersionDto {
  @IsDefined() @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class CreateInspectionDto {
  @Transform(normalizeCode) @IsDefined() @IsString() @Matches(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/) code!: string;
  @Transform(trimText) @IsDefined() @IsString() @IsNotEmpty() title!: string;
  @IsDefined() @IsUUID() systemId!: string;
  @IsDefined() @IsUUID() templateId!: string;
  @IsOptional() @IsUUID() areaId?: string | null;
  @IsOptional() @IsUUID() deviceId?: string | null;
}

export class CreateIssueDto {
  @Transform(trimText) @IsDefined() @IsString() @IsNotEmpty() description!: string;
  @IsDefined() @IsUUID() assigneeId!: string;
}

export class PutInspectionResultDto extends VersionDto {
  @IsDefined() @IsEnum(InspectionResult) result!: InspectionResult;
  @IsOptional() @IsString() note?: string | null;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => CreateIssueDto) issue?: CreateIssueDto | null;
}

export class ResolveIssueDto extends VersionDto {
  @Transform(trimText) @IsDefined() @IsString() @IsNotEmpty() resolutionNote!: string;
}

export class AssignIssueDto extends VersionDto {
  @IsDefined() @IsUUID() assigneeId!: string;
}

export class RecheckIssueDto extends VersionDto {
  @IsDefined() @IsInt() @Min(1) @Max(2147483647) expectedItemVersion!: number;
  @IsDefined() @IsIn([InspectionResult.PASS, InspectionResult.FAIL]) result!: InspectionResult.PASS | InspectionResult.FAIL;
  @Transform(trimText) @IsDefined() @IsString() @IsNotEmpty() note!: string;
  @IsOptional() @Transform(trimText) @IsString() @IsNotEmpty() reason?: string | null;
}
