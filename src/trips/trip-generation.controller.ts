import { Body, Controller, Post } from '@nestjs/common';
import { GenerateTripDto } from './dto/generate-trip.dto';
import { TripGenerationService } from './trip-generation.service';

@Controller('api-trips')
export class TripGenerationController {
  constructor(private readonly tripGenerationService: TripGenerationService) {}

  @Post()
  create(@Body() payload: GenerateTripDto) {
    return this.tripGenerationService.generate(payload);
  }
}
