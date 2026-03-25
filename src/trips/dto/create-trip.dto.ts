import {
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTripDto {
  @IsOptional()
  @IsString()
  profileId?: string;

  @IsString()
  @IsNotEmpty()
  location!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsObject()
  itinerary!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  originCity?: string;

  @IsOptional()
  @IsObject()
  flightBudget?: { amount: number; currency: string };

  @IsOptional()
  @IsObject()
  accommodationBudget?: { amount: number; currency: string };

  @IsOptional()
  @IsString()
  accommodationType?: string;
}
