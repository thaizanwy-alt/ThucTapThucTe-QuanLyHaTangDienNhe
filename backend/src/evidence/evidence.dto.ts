import { Transform } from 'class-transformer';
import { IsDefined, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { trimText } from '../projects/dto/dto.transforms';

export class EvidenceVersionDto {
  @IsDefined() @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}
export class UpdateEvidenceDto extends EvidenceVersionDto {
  @ValidateIf((_o, value) => value !== null)
  @IsDefined() @Transform(trimText) @IsString() @MaxLength(1000) caption!: string | null;
}
export class DeleteEvidenceDto extends EvidenceVersionDto {
  @IsDefined() @Transform(trimText) @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}
