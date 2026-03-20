import { IsArray, IsObject, IsOptional } from 'class-validator';

export class ContextualQuestionsDto {
  @IsObject()
  tripContext!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  conversationHistory?: Array<{ role: 'user' | 'agent'; text: string }>;
}
