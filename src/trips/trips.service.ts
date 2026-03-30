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

type TripCreateInput = Prisma.TripCreateInput;
type TripUpdateInput = Prisma.TripUpdateInput;
type DestinationCreateInput = Prisma.TripDestinationCreateWithoutTripInput;
type LegCreateInput = Prisma.TripLegCreateWithoutTripInput;

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pickCountryScope(payload: CreateTripDto): {
  scope: 'CITY' | 'COUNTRY';
  countryCode: string | null;
} {
  const fromPayload = payload.scope === 'COUNTRY' ? 'COUNTRY' : 'CITY';
  const itineraryObj = asObject(payload.itinerary);
  const overview = itineraryObj ? asObject(itineraryObj.tripOverview) : null;
  const overviewScope =
    overview && typeof overview.tripScope === 'string'
      ? overview.tripScope.toUpperCase()
      : null;
  const scope =
    fromPayload === 'COUNTRY' || overviewScope === 'COUNTRY'
      ? 'COUNTRY'
      : 'CITY';

  const countryCodeFromPayload =
    typeof payload.countryCode === 'string' &&
    payload.countryCode.trim().length > 0
      ? payload.countryCode.trim().toUpperCase()
      : null;
  const countryCodeFromOverview =
    overview &&
    typeof overview.countryCode === 'string' &&
    overview.countryCode.trim().length > 0
      ? overview.countryCode.trim().toUpperCase()
      : null;

  return {
    scope,
    countryCode: countryCodeFromPayload ?? countryCodeFromOverview,
  };
}

function parseDestinations(payload: CreateTripDto): DestinationCreateInput[] {
  const itineraryObj = asObject(payload.itinerary);
  const itineraryDestinations = Array.isArray(itineraryObj?.destinations)
    ? (itineraryObj?.destinations as unknown[])
    : [];
  const candidates =
    Array.isArray(payload.destinations) && payload.destinations.length > 0
      ? payload.destinations
      : itineraryDestinations;

  const rows: DestinationCreateInput[] = [];

  candidates.forEach((entry, index) => {
    const obj = asObject(entry);
    if (!obj) return;

    const stopOrderRaw =
      typeof obj.stopOrder === 'number'
        ? obj.stopOrder
        : Number.parseInt(String(obj.stopOrder ?? index + 1), 10);
    const cityName =
      typeof obj.cityName === 'string' ? obj.cityName.trim() : '';
    const countryCode =
      typeof obj.countryCode === 'string'
        ? obj.countryCode.trim().toUpperCase()
        : '';
    const latitude =
      typeof obj.latitude === 'number'
        ? obj.latitude
        : Number.parseFloat(String(obj.latitude ?? 'NaN'));
    const longitude =
      typeof obj.longitude === 'number'
        ? obj.longitude
        : Number.parseFloat(String(obj.longitude ?? 'NaN'));
    const nights =
      typeof obj.nights === 'number'
        ? obj.nights
        : obj.nights == null
          ? null
          : Number.parseInt(String(obj.nights), 10);

    if (
      !Number.isFinite(stopOrderRaw) ||
      cityName.length === 0 ||
      countryCode.length === 0 ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      return;
    }

    rows.push({
      stopOrder: stopOrderRaw,
      cityName,
      countryCode,
      latitude,
      longitude,
      startDate:
        typeof obj.startDate === 'string' ? parseIsoDate(obj.startDate) : null,
      endDate:
        typeof obj.endDate === 'string' ? parseIsoDate(obj.endDate) : null,
      nights: Number.isFinite(nights) ? nights : null,
      selectedHotelSnapshot: (obj.selectedHotelSnapshot ??
        Prisma.JsonNull) as DestinationCreateInput['selectedHotelSnapshot'],
    });
  });

  return rows.sort((a, b) => a.stopOrder - b.stopOrder);
}

function parseLegs(payload: CreateTripDto): LegCreateInput[] {
  const itineraryObj = asObject(payload.itinerary);
  const itineraryLegs = Array.isArray(itineraryObj?.tripLegs)
    ? (itineraryObj?.tripLegs as unknown[])
    : [];
  const candidates =
    Array.isArray(payload.legs) && payload.legs.length > 0
      ? payload.legs
      : itineraryLegs;

  const rows: LegCreateInput[] = [];

  candidates.forEach((entry, index) => {
    const obj = asObject(entry);
    if (!obj) return;

    const legOrderRaw =
      typeof obj.legOrder === 'number'
        ? obj.legOrder
        : Number.parseInt(String(obj.legOrder ?? index + 1), 10);
    const fromStopOrderRaw =
      typeof obj.fromStopOrder === 'number'
        ? obj.fromStopOrder
        : Number.parseInt(String(obj.fromStopOrder ?? index + 1), 10);
    const toStopOrderRaw =
      typeof obj.toStopOrder === 'number'
        ? obj.toStopOrder
        : Number.parseInt(String(obj.toStopOrder ?? index + 2), 10);

    const mode =
      typeof obj.mode === 'string' && obj.mode.trim().length > 0
        ? obj.mode.trim().toLowerCase()
        : 'flight';

    if (
      !Number.isFinite(legOrderRaw) ||
      !Number.isFinite(fromStopOrderRaw) ||
      !Number.isFinite(toStopOrderRaw)
    ) {
      return;
    }

    rows.push({
      legOrder: legOrderRaw,
      fromStopOrder: fromStopOrderRaw,
      toStopOrder: toStopOrderRaw,
      mode,
      departureDate:
        typeof obj.departureDate === 'string'
          ? parseIsoDate(obj.departureDate)
          : null,
      selectedFlightSnapshot: (obj.selectedFlightSnapshot ??
        Prisma.JsonNull) as LegCreateInput['selectedFlightSnapshot'],
    });
  });

  return rows.sort((a, b) => a.legOrder - b.legOrder);
}

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

    const { scope, countryCode } = pickCountryScope(payload);
    const destinations = parseDestinations(payload);
    const legs = parseLegs(payload);
    const itineraryObj = asObject(payload.itinerary);
    const routeGeoJsonCandidate =
      payload.routeGeoJson ??
      (itineraryObj && asObject(itineraryObj.routeGeoJson)
        ? (itineraryObj.routeGeoJson as Record<string, unknown>)
        : null);
    const routeGeoJson = (routeGeoJsonCandidate ??
      Prisma.JsonNull) as TripCreateInput['routeGeoJson'];

    // Detect and store preferred currency on first trip if not already set
    const profile = await this.prisma.profile.findUnique({
      where: { id: payload.profileId! },
      select: { preferredCurrency: true },
    });

    if (!profile?.preferredCurrency && clientIp) {
      try {
        const geoRes = await fetch(`https://ipapi.co/${clientIp}/json/`, {
          cache: 'no-store',
        });
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
        itinerary: payload.itinerary as TripCreateInput['itinerary'],
        originCity: payload.originCity ?? null,
        scope,
        countryCode,
        routeGeoJson,
        flightBudget: (payload.flightBudget ??
          Prisma.JsonNull) as TripCreateInput['flightBudget'],
        accommodationBudget: (payload.accommodationBudget ??
          Prisma.JsonNull) as TripCreateInput['accommodationBudget'],
        accommodationType: payload.accommodationType ?? null,
        destinations: {
          create: destinations.map((destination) => ({
            stopOrder: destination.stopOrder,
            cityName: destination.cityName,
            countryCode: destination.countryCode,
            latitude: destination.latitude,
            longitude: destination.longitude,
            startDate: destination.startDate,
            endDate: destination.endDate,
            nights: destination.nights,
            selectedHotelSnapshot: destination.selectedHotelSnapshot,
          })),
        },
        legs: {
          create: legs.map((leg) => ({
            legOrder: leg.legOrder,
            fromStopOrder: leg.fromStopOrder,
            toStopOrder: leg.toStopOrder,
            mode: leg.mode,
            departureDate: leg.departureDate,
            selectedFlightSnapshot: leg.selectedFlightSnapshot,
          })),
        },
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
        scope: true,
        countryCode: true,
      },
    });
  }

  async findOne(id: string, profileId: string) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      include: {
        destinations: { orderBy: { stopOrder: 'asc' } },
        legs: { orderBy: { legOrder: 'asc' } },
      },
    });

    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.profileId !== profileId) throw new ForbiddenException();

    return trip;
  }

  async updateItinerary(
    id: string,
    profileId: string,
    itinerary: Record<string, unknown>,
  ) {
    const trip = await this.prisma.trip.findUnique({
      where: { id },
      select: { id: true, profileId: true },
    });
    if (!trip) throw new NotFoundException('Trip not found');
    if (trip.profileId !== profileId) throw new ForbiddenException();

    if (!isTripItinerary(itinerary)) {
      throw new BadRequestException('Invalid itinerary payload format');
    }

    const itineraryObj = asObject(itinerary);
    const payloadLike = {
      itinerary,
      scope:
        itineraryObj &&
        asObject(itineraryObj.tripOverview) &&
        typeof (itineraryObj.tripOverview as Record<string, unknown>)
          .tripScope === 'string'
          ? String(
              (itineraryObj.tripOverview as Record<string, unknown>).tripScope,
            ).toUpperCase() === 'COUNTRY'
            ? 'COUNTRY'
            : 'CITY'
          : undefined,
      countryCode:
        itineraryObj &&
        asObject(itineraryObj.tripOverview) &&
        typeof (itineraryObj.tripOverview as Record<string, unknown>)
          .countryCode === 'string'
          ? String(
              (itineraryObj.tripOverview as Record<string, unknown>)
                .countryCode,
            )
          : null,
    } as CreateTripDto;

    const { scope, countryCode } = pickCountryScope(payloadLike);
    const destinations = parseDestinations(payloadLike);
    const legs = parseLegs(payloadLike);
    const routeGeoJsonCandidate =
      itineraryObj && asObject(itineraryObj.routeGeoJson)
        ? (itineraryObj.routeGeoJson as Record<string, unknown>)
        : null;
    const routeGeoJson = (routeGeoJsonCandidate ??
      Prisma.JsonNull) as TripUpdateInput['routeGeoJson'];

    return this.prisma.trip.update({
      where: { id },
      data: {
        itinerary: itinerary as TripUpdateInput['itinerary'],
        scope,
        countryCode,
        routeGeoJson,
        destinations: {
          deleteMany: {},
          create: destinations.map((destination) => ({
            stopOrder: destination.stopOrder,
            cityName: destination.cityName,
            countryCode: destination.countryCode,
            latitude: destination.latitude,
            longitude: destination.longitude,
            startDate: destination.startDate,
            endDate: destination.endDate,
            nights: destination.nights,
            selectedHotelSnapshot: destination.selectedHotelSnapshot,
          })),
        },
        legs: {
          deleteMany: {},
          create: legs.map((leg) => ({
            legOrder: leg.legOrder,
            fromStopOrder: leg.fromStopOrder,
            toStopOrder: leg.toStopOrder,
            mode: leg.mode,
            departureDate: leg.departureDate,
            selectedFlightSnapshot: leg.selectedFlightSnapshot,
          })),
        },
      },
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
