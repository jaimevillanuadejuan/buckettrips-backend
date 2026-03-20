import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TripConversationService } from './trip-conversation.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [AuthModule],
  controllers: [TripsController],
  providers: [TripsService, TripConversationService],
})
export class TripsModule {}
