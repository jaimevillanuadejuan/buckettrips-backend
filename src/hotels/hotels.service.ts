import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HotelResult } from './hotel-result.dto';

interface SerpApiProperty {
  name?: string;
  hotel_class?: number | string | null;
  overall_rating?: number | null;
  reviews?: number | null;
  rate_per_night?: {
    lowest?: string | null;
  } | null;
  thumbnail?: string | null;
  link?: string | null;
  amenities?: string[] | null;
}

interface SerpApiHotelsResponse {
  properties?: SerpApiProperty[];
  error?: string;
}

function parsePriceString(value: string | null | undefined): number | null {
  if (!value) return null;
  const numeric = value.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

@Injectable()
export class HotelsService {
  async searchHotels(params: {
    destination: string;
    checkIn: string;
    checkOut: string;
    guests?: number;
    budget?: number;
    currency?: string;
  }): Promise<HotelResult[]> {
    const apiKey = process.env.SERP_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('Missing SERPAPI_API_KEY configuration');
    }

    const currency = params.currency ?? 'USD';
    const adults = params.guests ?? 2;

    const url = new URL('https://serpapi.com/search');
    url.searchParams.set('engine', 'google_hotels');
    url.searchParams.set('q', `${params.destination} hotels`);
    url.searchParams.set('check_in_date', params.checkIn);
    url.searchParams.set('check_out_date', params.checkOut);
    url.searchParams.set('adults', String(adults));
    url.searchParams.set('currency', currency);
    url.searchParams.set('api_key', apiKey);

    let data: SerpApiHotelsResponse;
    try {
      const res = await fetch(url.toString(), { cache: 'no-store' });
      data = (await res.json()) as SerpApiHotelsResponse;
    } catch {
      throw new ServiceUnavailableException('Failed to reach SerpApi');
    }

    if (data.error) {
      throw new ServiceUnavailableException(`SerpApi error: ${data.error}`);
    }

    const properties = data.properties ?? [];

    return properties
      .filter((p) => parsePriceString(p.rate_per_night?.lowest) !== null)
      .slice(0, 8)
      .map((p): HotelResult => {
        const stars = p.hotel_class != null ? Number(p.hotel_class) : null;
        const name = p.name ?? 'Unknown Hotel';

        // Always use Google Hotels search link — SerpApi's `link` is the hotel's own site
        const googleHotelsUrl = `https://www.google.com/travel/hotels?q=${encodeURIComponent(name + ' ' + params.destination)}`;

        return {
          name,
          stars: Number.isFinite(stars) ? stars : null,
          overallRating: p.overall_rating ?? null,
          reviews: p.reviews ?? null,
          pricePerNight: parsePriceString(p.rate_per_night?.lowest),
          currency,
          thumbnailUrl: p.thumbnail ?? null,
          deepLinkUrl: googleHotelsUrl,
          amenities: p.amenities ?? [],
        };
      });
  }
}
