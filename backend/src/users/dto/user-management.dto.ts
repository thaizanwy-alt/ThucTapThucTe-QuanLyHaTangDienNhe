import { IsBoolean, IsDefined, IsEmail, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateTechnicianDto {
  @IsDefined() @IsEmail() @MaxLength(320) email!: string;
  @IsDefined() @IsString() @MinLength(1) temporaryPassword!: string;
}

export class UpdateTechnicianStatusDto {
  @IsDefined() @IsBoolean() isActive!: boolean;
  @IsDefined() @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}

export class ResetTechnicianPasswordDto {
  @IsDefined() @IsString() @MinLength(1) temporaryPassword!: string;
  @IsDefined() @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
}
