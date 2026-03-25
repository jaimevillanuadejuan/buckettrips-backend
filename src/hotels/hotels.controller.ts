import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { HotelsService } from './hotels.service';

@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Get('search')
  async search(
    @Query('destination') destination?: string,
    @Query('checkIn') checkIn?: string,
    @Query('checkOut') checkOut?: string,
    @Query('guests') guests?: string,
    @Query('budget') budget?: string,
    @Query('currency') currency?: string,
  ) {
    if (!destination || !checkIn || !checkOut) {
      throw new BadRequestException('destination, checkIn, and checkOut are required');
    }

    return this.hotelsService.searchHotels({
      destination,
      checkIn,
      checkOut,
      guests: guests ? parseInt(guests, 10) : undefined,
      budget: budget ? parseFloat(budget) : undefined,
      currency,
    });
  }
}
