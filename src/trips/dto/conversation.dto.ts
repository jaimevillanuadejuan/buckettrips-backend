import { IsArray, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class ConversationDto {
  @IsObject()
  tripContext!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  currentStep!: string;

  @IsString()
  @IsNotEmpty()
  lastUserUtterance!: string;

  @IsOptional()
  @IsArray()
  conversationHistory?: Array<{ role: 'user' | 'agent'; text: string }>;

  @IsOptional()
  @IsString()
  detectedOriginCity?: string;
}
