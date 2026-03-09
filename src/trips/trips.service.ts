import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { isTripItinerary } from './validators/is-trip-itinerary';

@Injectable()
export class TripsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(payload: CreateTripDto) {
    if (!isTripItinerary(payload.itinerary)) {
      throw new BadRequestException('Invalid itinerary payload format');
    }

    const startDate = new Date(payload.startDate);
    const endDate = new Date(payload.endDate);

    if (startDate > endDate) {
      throw new BadRequestException(
        'startDate must be before or equal to endDate',
      );
    }

    const created = await this.prisma.trip.create({
      data: {
        location: payload.location.trim(),
        startDate,
        endDate,
        theme: payload.theme,
        provider: payload.provider?.trim() || null,
        model: payload.model?.trim() || null,
        itinerary: payload.itinerary as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        createdAt: true,
      },
    });

    return created;
  }

  async findAll() {
    return this.prisma.trip.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        location: true,
        theme: true,
        startDate: true,
        endDate: true,
        provider: true,
        model: true,
        createdAt: true,
      },
    });
  }

  async findOne(id: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
    });

    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    return trip;
  }

  async remove(id: string) {
    const existing = await this.prisma.trip.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Trip not found');
    }

    await this.prisma.trip.delete({
      where: { id },
    });
  }
}
