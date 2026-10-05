import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { normalizeCode, trimText } from '../../projects/dto/dto.transforms';
import { ConnectionKind, PortSide } from '../connection.enums';

const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export class CreatePortDto {
  @Transform(normalizeCode) @IsDefined() @IsString() @Matches(CODE_PATTERN) code!: string;
  @IsOptional() @Transform(trimText) @IsString() description?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(4094) accessVlanId?: number | null;
  @IsOptional() @IsBoolean() poeEnabled?: boolean | null;
}
export class UpdatePortDto {
  @ValidateIf((_object, value) => value !== undefined)
  @Transform(normalizeCode) @IsDefined() @IsString() @Matches(CODE_PATTERN) code?: string;
  @IsOptional() @Transform(trimText) @IsString() description?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(4094) accessVlanId?: number | null;
  @IsOptional() @IsBoolean() poeEnabled?: boolean | null;
}
export class EndpointDto {
  @IsDefined() @IsUUID() portId!: string;
  @IsDefined() @IsEnum(PortSide) side!: PortSide;
}
export class ConnectionRouteDto {
  @IsDefined() @IsEnum(ConnectionKind) kind!: ConnectionKind;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => EndpointDto) a!: EndpointDto;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => EndpointDto) b!: EndpointDto;
}
export class CreateConnectionDto extends ConnectionRouteDto {
  @IsOptional() @Transform(trimText) @IsString() label?: string | null;
  @IsOptional() @Transform(trimText) @IsString() description?: string | null;
}
export class RewireDto extends ConnectionRouteDto {
  @IsDefined() @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}
export class ConnectionsQueryDto {
  @ValidateIf((_object, value) => value !== undefined) @IsDefined() @IsUUID() deviceId?: string;
}
export class TraceQueryDto {
  @Transform(normalizeCode) @IsDefined() @IsString() @Matches(CODE_PATTERN) deviceCode!: string;
}
