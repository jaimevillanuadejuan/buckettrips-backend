import {
  BadRequestException,
  ForbiddenException,
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

  async create(payload: CreateTripDto, clientIp?: string) {
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

    // Detect and store preferred currency on first trip if not already set
    const profile = await this.prisma.profile.findUnique({
      where: { id: payload.profileId! },
      select: { preferredCurrency: true },
    });

    if (!profile?.preferredCurrency && clientIp) {
      try {
        const geoRes = await fetch(`https://ipapi.co/${clientIp}/json/`, { cache: 'no-store' });
        if (geoRes.ok) {
          const geo = (await geoRes.json()) as { currency?: string };
          if (geo.currency) {
            await this.prisma.profile.update({
              where: { id: payload.profileId! },
              data: { preferredCurrency: geo.currency },
            });
          }
        }
      } catch {
        // silently ignore — not critical
      }
    }

    return this.prisma.trip.create({
      data: {
        profileId: payload.profileId!,
        location: payload.location.trim(),
        startDate,
        endDate,
        provider: payload.provider?.trim() || null,
        model: payload.model?.trim() || null,
        itinerary: (payload.itinerary ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        originCity: payload.originCity ?? null,
        flightBudget: payload.flightBudget
          ? (payload.flightBudget as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        accommodationBudget: payload.accommodationBudget
          ? (payload.accommodationBudget as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        accommodationType: payload.accommodationType ?? null,
      },
      select: { id: true, createdAt: true },
    });
  }

  async findAll(profileId: string) {
    return this.prisma.trip.findMany({
      where: { profileId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        location: true,
        startDate: true,
        endDate: true,
        provider: true,
        model: true,
        createdAt: true,
      },
    });
  }

  async findOne(id: string, profileId: string) {
    const trip = await this.prisma.trip.findUnique({ where: { id } });

    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.profileId !== profileId) throw new ForbiddenException();

    return trip;
  }

  async updateItinerary(id: string, profileId: string, itinerary: Record<string, unknown>) {
    const trip = await this.prisma.trip.findUnique({ where: { id }, select: { id: true, profileId: true } });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.profileId !== profileId) throw new ForbiddenException();

    if (!isTripItinerary(itinerary)) {
      throw new BadRequestException('Invalid itinerary payload format');
    }

    return this.prisma.trip.update({
      where: { id },
      data: { itinerary: (itinerary ?? Prisma.JsonNull) as Prisma.InputJsonValue },
      select: { id: true, updatedAt: true },
    });
  }

  async remove(id: string, profileId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      select: { id: true, profileId: true },
    });

    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.profileId !== profileId) throw new ForbiddenException();

    await this.prisma.trip.delete({ where: { id } });
  }
}
