import { Module } from '@nestjs/common';
import { TripGenerationController } from './trip-generation.controller';
import { TripGenerationService } from './trip-generation.service';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  controllers: [TripsController, TripGenerationController],
  providers: [TripsService, TripGenerationService],
})
export class TripsModule {}
