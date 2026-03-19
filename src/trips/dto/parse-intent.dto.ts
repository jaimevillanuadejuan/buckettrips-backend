import { IsNotEmpty, IsString } from 'class-validator';

export class ParseIntentDto {
  @IsString()
  @IsNotEmpty()
  rawInput!: string;
}
