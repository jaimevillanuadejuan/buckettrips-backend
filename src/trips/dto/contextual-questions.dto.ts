import { IsObject } from 'class-validator';

export class ContextualQuestionsDto {
  @IsObject()
  tripContext!: Record<string, unknown>;
}
