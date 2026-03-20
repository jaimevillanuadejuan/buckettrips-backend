import { IsArray, IsObject, IsOptional, IsString } from 'class-validator';

export class RefineTripDto {
  @IsObject()
  itinerary!: Record<string, unknown>;

  @IsString()
  message!: string;

  @IsOptional()
  @IsArray()
  history?: Array<{ role: 'user' | 'agent'; text: string }>;
}
