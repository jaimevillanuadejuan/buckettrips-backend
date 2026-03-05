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
import { CreateTripDto } from './dto/create-trip.dto';
import { TripsService } from './trips.service';

@Controller('trips')
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

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
