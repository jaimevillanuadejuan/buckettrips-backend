import { Controller, Get, Query } from '@nestjs/common';
import { AccommodationsService } from './accommodations.service';

@Controller('accommodations')
export class AccommodationsController {
  constructor(private readonly accommodationsService: AccommodationsService) {}

  @Get('style-filter')
  styleFilter(
    @Query('destination') destination?: string,
    @Query('budgetTier') budgetTier?: string,
    @Query('style') style?: string,
  ) {
    return this.accommodationsService.getStyleOptions({
      destination,
      budgetTier,
      style,
    });
  }
}
