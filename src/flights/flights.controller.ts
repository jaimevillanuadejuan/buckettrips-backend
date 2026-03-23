import { Controller, Get, Query } from '@nestjs/common';
import { FlightsService } from './flights.service';

@Controller('flights')
export class FlightsController {
  constructor(private readonly flightsService: FlightsService) {}

  @Get('search')
  search(
    @Query('origin') origin: string,
    @Query('destination') destination: string,
    @Query('departureDate') departureDate: string,
    @Query('returnDate') returnDate?: string,
    @Query('budget') budget?: string,
    @Query('currency') currency?: string,
    @Query('adults') adults?: string,
  ) {
    return this.flightsService.searchFlights({
      origin,
      destination,
      departureDate,
      returnDate,
      budget: budget ? Number(budget) : undefined,
      currency,
      adults: adults ? Number(adults) : undefined,
    });
  }
}
