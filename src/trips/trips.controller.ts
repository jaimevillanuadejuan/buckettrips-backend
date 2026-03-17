import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ConfirmTripDto } from './dto/confirm-trip.dto';
import { ContextualQuestionsDto } from './dto/contextual-questions.dto';
import { ConversationDto } from './dto/conversation.dto';
import { CreateTripDto } from './dto/create-trip.dto';
import { ParseIntentDto } from './dto/parse-intent.dto';
import { TripConversationService } from './trip-conversation.service';
import { TripsService } from './trips.service';

@Controller('trips')
export class TripsController {
  constructor(
    private readonly tripsService: TripsService,
    private readonly tripConversationService: TripConversationService,
  ) {}

  @Post('parse-intent')
  parseIntent(@Body() payload: ParseIntentDto) {
    return this.tripConversationService.parseIntent(payload.rawInput);
  }

  @Post('contextual-questions')
  contextualQuestions(@Body() payload: ContextualQuestionsDto) {
    return this.tripConversationService.generateContextualQuestions(
      payload.tripContext,
    );
  }

  @Post('conversation')
  conversation(@Body() payload: ConversationDto) {
    return this.tripConversationService.continueConversation(payload);
  }

  @Post('confirm')
  confirm(@Body() payload: ConfirmTripDto) {
    return this.tripConversationService.confirmTrip(payload);
  }

  @Post()
  create(@Body() payload: CreateTripDto) {
    return this.tripsService.create(payload);
  }

  @Get()
  findAll() {
    return this.tripsService.findAll();
  }

  @Get(':tripId')
  findOne(@Param('tripId') tripId: string) {
    return this.tripsService.findOne(tripId);
  }

  @Delete(':tripId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('tripId') tripId: string) {
    await this.tripsService.remove(tripId);
  }
}
