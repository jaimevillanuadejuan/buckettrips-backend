import { Module } from '@nestjs/common';
import { TripsController } from './trips.controller';
import { TripConversationService } from './trip-conversation.service';
import { TripsService } from './trips.service';

@Module({
  controllers: [TripsController],
  providers: [TripsService, TripConversationService],
})
export class TripsModule {}
