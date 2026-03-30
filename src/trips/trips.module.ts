import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FlightsModule } from '../flights/flights.module';
import { HotelsModule } from '../hotels/hotels.module';
import { TripConversationService } from './trip-conversation.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [AuthModule, FlightsModule, HotelsModule],
  controllers: [TripsController],
  providers: [TripsService, TripConversationService],
})
export class TripsModule {}
