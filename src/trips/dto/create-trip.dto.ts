import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';

interface TripDestinationInput {
  stopOrder: number;
  cityName: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  startDate?: string | null;
  endDate?: string | null;
  nights?: number | null;
  selectedHotelSnapshot?: Record<string, unknown> | null;
}

interface TripLegInput {
  legOrder: number;
  fromStopOrder: number;
  toStopOrder: number;
  mode?: string | null;
  departureDate?: string | null;
  selectedFlightSnapshot?: Record<string, unknown> | null;
}

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

  @IsOptional()
  @IsString()
  scope?: 'CITY' | 'COUNTRY';

  @ValidateIf((o: CreateTripDto) => o.scope === 'COUNTRY')
  @IsOptional()
  @IsString()
  countryCode?: string | null;

  @IsOptional()
  @IsObject()
  routeGeoJson?: Record<string, unknown> | null;

  @IsOptional()
  @IsArray()
  destinations?: TripDestinationInput[];

  @IsOptional()
  @IsArray()
  legs?: TripLegInput[];
}
