import { IsDefined, IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsDefined() @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @IsDefined() @IsString() @MinLength(1) currentPassword!: string;
  @IsDefined() @IsString() @MinLength(1) newPassword!: string;
}
