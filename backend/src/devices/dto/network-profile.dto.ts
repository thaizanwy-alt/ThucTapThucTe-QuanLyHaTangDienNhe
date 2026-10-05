import { Transform } from 'class-transformer';
import { IsDefined, IsEnum, IsIP, IsString, Matches, ValidateIf } from 'class-validator';
import { trimText } from '../../projects/dto/dto.transforms';
import { AddressMode } from '../address-mode.enum';

const normalizeMac = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class PutDeviceNetworkProfileDto {
  @ValidateIf((_object, value) => value !== null)
  @IsDefined()
  @IsEnum(AddressMode)
  addressMode!: AddressMode | null;

  @ValidateIf((_object, value) => value !== null)
  @Transform(trimText)
  @IsDefined()
  @IsIP('4')
  ipAddress!: string | null;

  @ValidateIf((_object, value) => value !== null)
  @Transform(normalizeMac)
  @IsDefined()
  @IsString()
  @Matches(/^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/)
  macAddress!: string | null;
}
