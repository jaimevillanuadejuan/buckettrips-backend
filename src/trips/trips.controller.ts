import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { ChatDto } from './dto/chat.dto';
import { ConfirmTripDto } from './dto/confirm-trip.dto';
import { ContextualQuestionsDto } from './dto/contextual-questions.dto';
import { ConversationDto } from './dto/conversation.dto';
import { CreateTripDto } from './dto/create-trip.dto';
import { ParseIntentDto } from './dto/parse-intent.dto';
import { RefineTripDto } from './dto/refine-trip.dto';
import { TripConversationService } from './trip-conversation.service';
import { TripsService } from './trips.service';

@Controller('trips')
export class TripsController {
  constructor(
    private readonly tripsService: TripsService,
    private readonly tripConversationService: TripConversationService,
  ) {}

  // ── Conversational / AI endpoints (no auth required) ──────────────────────

  @Post('parse-intent')
  parseIntent(@Body() payload: ParseIntentDto) {
    return this.tripConversationService.parseIntent(payload.rawInput);
  }

  @Post('contextual-questions')
  contextualQuestions(@Body() payload: ContextualQuestionsDto) {
    return this.tripConversationService.generateContextualQuestions(
      payload.tripContext,
      payload.conversationHistory,
    );
  }

  @Post('conversation')
  conversation(@Body() payload: ConversationDto) {
    return this.tripConversationService.continueConversation(payload);
  }

  @Post('chat')
  chat(@Body() payload: ChatDto) {
    return this.tripConversationService.chat(payload);
  }

  @Post('refine')
  refine(@Body() payload: RefineTripDto) {
    return this.tripConversationService.refineTrip(payload);
  }

  @Post('confirm')
  confirm(@Body() payload: ConfirmTripDto) {
    return this.tripConversationService.confirmTrip(payload);
  }

  // ── CRUD endpoints (auth required) ────────────────────────────────────────

  @UseGuards(AuthGuard)
  @Post()
  create(
    @Body() payload: CreateTripDto,
    @Req() req: Request & { user: { profileId: string } },
  ) {
    payload.profileId = req.user.profileId;
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      undefined;
    return this.tripsService.create(payload, clientIp);
  }

  @UseGuards(AuthGuard)
  @Get()
  findAll(@Req() req: { user: { profileId: string } }) {
    return this.tripsService.findAll(req.user.profileId);
  }

  @UseGuards(AuthGuard)
  @Get(':tripId')
  findOne(
    @Param('tripId') tripId: string,
    @Req() req: { user: { profileId: string } },
  ) {
    return this.tripsService.findOne(tripId, req.user.profileId);
  }

  @UseGuards(AuthGuard)
  @Patch(':tripId')
  updateItinerary(
    @Param('tripId') tripId: string,
    @Body() body: { itinerary: Record<string, unknown> },
    @Req() req: { user: { profileId: string } },
  ) {
    return this.tripsService.updateItinerary(
      tripId,
      req.user.profileId,
      body.itinerary,
    );
  }

  @UseGuards(AuthGuard)
  @Delete(':tripId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('tripId') tripId: string,
    @Req() req: { user: { profileId: string } },
  ) {
    await this.tripsService.remove(tripId, req.user.profileId);
  }
}
