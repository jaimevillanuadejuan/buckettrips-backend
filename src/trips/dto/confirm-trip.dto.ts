import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class ConfirmTripDto {
  @IsObject()
  tripContext!: Record<string, unknown>;

  @IsDateString()
  exactStartDate!: string;

  @IsDateString()
  exactEndDate!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  followUpAnswers?: string[];
}
