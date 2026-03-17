import { IsNotEmpty, IsObject, IsString } from 'class-validator';

export class ConversationDto {
  @IsObject()
  tripContext!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  currentStep!: string;

  @IsString()
  @IsNotEmpty()
  lastUserUtterance!: string;
}
