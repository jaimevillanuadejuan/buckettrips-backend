import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FlightResult } from './flight-result.dto';

const SERP_API_URL = 'https://serpapi.com/search.json';
const SERP_AUTOCOMPLETE_URL = 'https://serpapi.com/search.json';

interface SerpAutocompleteSuggestion {
  name?: string;
  type?: string;
  id?: string;
  airports?: Array<{ id?: string; name?: string; city?: string }>;
}

interface SerpAutocompleteResponse {
  suggestions?: SerpAutocompleteSuggestion[];
  error?: string;
}

interface SerpFlightLeg {
  departure_airport?: { name?: string; id?: string; time?: string };
  arrival_airport?: { name?: string; id?: string; time?: string };
  duration?: number; // minutes
  airline?: string;
  airline_logo?: string;
  travel_class?: string;
  flight_number?: string;
  extensions?: string[];
  overnight?: boolean;
  often_delayed_by_over_30_min?: boolean;
}

interface SerpFlightOption {
  flights?: SerpFlightLeg[];
  total_duration?: number; // minutes
  carbon_emissions?: { this_flight?: number };
  price?: number;
  type?: string; // "Round trip" | "One way"
  airline_logo?: string;
  departure_token?: string;
  layovers?: Array<{ duration?: number; name?: string; id?: string; overnight?: boolean }>;
  booking_token?: string;
}

interface SerpFlightsResponse {
  best_flights?: SerpFlightOption[];
  other_flights?: SerpFlightOption[];
  search_metadata?: { google_flights_url?: string };
  error?: string;
}

@Injectable()
export class FlightsService {
  private readonly serpApiKey: string;

  constructor(private readonly config: ConfigService) {
    this.serpApiKey = config.get<string>('SERP_API_KEY') ?? '';
  }

  private formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  /**
   * Resolves a city/country name to an IATA airport code using SerpApi autocomplete.
   * Returns the input unchanged if it already looks like an IATA code (2-3 uppercase letters).
   */
  private async resolveToIata(cityName: string): Promise<string> {
    // Already an IATA code
    if (/^[A-Z]{2,3}$/.test(cityName.trim())) {
      return cityName.trim();
    }

    // Strip country suffix (e.g. "New York, USA" → "New York")
    const query = cityName.split(',')[0].trim();

    try {
      const url = new URL(SERP_AUTOCOMPLETE_URL);
      url.searchParams.set('engine', 'google_flights_autocomplete');
      url.searchParams.set('api_key', this.serpApiKey);
      url.searchParams.set('q', query);
      url.searchParams.set('hl', 'en');
      url.searchParams.set('gl', 'es');

      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) {
        console.warn(`[flights] Autocomplete failed for "${query}": HTTP ${res.status}`);
        return query;
      }

      const json = (await res.json()) as SerpAutocompleteResponse;
      const suggestions = json.suggestions ?? [];

      // Prefer a city-type suggestion with airports
      for (const s of suggestions) {
        if (s.airports && s.airports.length > 0 && s.airports[0].id) {
          console.log(`[flights] Resolved "${query}" → ${s.airports[0].id} (${s.airports[0].name})`);
          return s.airports[0].id;
        }
      }

      // Fallback: region/country suggestion with an id that looks like IATA
      for (const s of suggestions) {
        if (s.id && /^[A-Z]{2,3}$/.test(s.id)) {
          console.log(`[flights] Resolved "${query}" → ${s.id} (region)`);
          return s.id;
        }
      }

      console.warn(`[flights] Could not resolve "${query}" to IATA — using raw query`);
      return query;
    } catch (err) {
      console.warn(`[flights] Autocomplete error for "${query}":`, err);
      return query;
    }
  }

  async searchFlights(params: {
    origin: string;
    destination: string;
    departureDate: string;
    returnDate?: string;
    budget?: number;
    currency?: string;
    adults?: number;
  }): Promise<FlightResult[]> {
    if (!this.serpApiKey) {
      throw new ServiceUnavailableException('Flight search is not configured (missing SERP_API_KEY)');
    }

    // Resolve city names to IATA codes via SerpApi autocomplete
    const [originId, destinationId] = await Promise.all([
      this.resolveToIata(params.origin),
      this.resolveToIata(params.destination),
    ]);

    // Ensure dates are YYYY-MM-DD only — strip any ISO time suffix
    const departureDate = params.departureDate.split('T')[0];
    const returnDate = params.returnDate?.split('T')[0];

    console.log(`[flights] Searching: ${originId} → ${destinationId} on ${departureDate}`);

    const url = new URL(SERP_API_URL);
    url.searchParams.set('engine', 'google_flights');
    url.searchParams.set('api_key', this.serpApiKey);
    url.searchParams.set('departure_id', originId);
    url.searchParams.set('arrival_id', destinationId);
    url.searchParams.set('outbound_date', departureDate);
    if (returnDate) {
      url.searchParams.set('return_date', returnDate);
      url.searchParams.set('type', '1'); // round trip
    } else {
      url.searchParams.set('type', '2'); // one way
    }
    url.searchParams.set('adults', String(params.adults ?? 1));
    url.searchParams.set('currency', params.currency ?? 'USD');
    url.searchParams.set('hl', 'en');
    url.searchParams.set('gl', 'es');

    const res = await fetch(url.toString(), { cache: 'no-store' });
    console.log('[flights] SerpApi URL:', url.toString().replace(this.serpApiKey, 'REDACTED'));
    console.log('[flights] SerpApi status:', res.status);

    if (!res.ok) {
      const errText = await res.text();
      console.error('[flights] SerpApi error response:', errText);
      return [];
    }

    const json = (await res.json()) as SerpFlightsResponse;
    if (json.error) {
      console.error('[flights] SerpApi error:', json.error);
      // If no results and destination looks like a country code, retry with capital city
      if (json.error.includes('no results') || json.error.includes("hasn't returned")) {
        console.log('[flights] Retrying with Mexico City as fallback destination');
        const fallbackMap: Record<string, string> = {
          MEX: 'Mexico City',
          THA: 'Bangkok',
          IND: 'Delhi',
          CHN: 'Beijing',
          BRA: 'Sao Paulo',
          ARG: 'Buenos Aires',
          COL: 'Bogota',
          PER: 'Lima',
          CHL: 'Santiago',
        };
        const fallback = fallbackMap[destinationId];
        if (fallback) {
          const fallbackId = await this.resolveToIata(fallback);
          if (fallbackId !== destinationId) {
            url.searchParams.set('arrival_id', fallbackId);
            const retryRes = await fetch(url.toString(), { cache: 'no-store' });
            const retryJson = (await retryRes.json()) as SerpFlightsResponse;
            if (!retryJson.error) {
              const retryOptions = [...(retryJson.best_flights ?? []), ...(retryJson.other_flights ?? [])];
              const retryGoogleUrl = retryJson.search_metadata?.google_flights_url ?? '';
              const retryCurrency = params.currency ?? 'USD';
              return retryOptions.slice(0, 5).map((option): FlightResult | null => {
                const firstLeg = option.flights?.[0];
                if (!firstLeg) return null;
                const price = option.price ?? 0;
                if (params.budget && price > params.budget) return null;
                const lastLeg = option.flights?.[option.flights.length - 1];
                return {
                  airline: firstLeg.airline ?? 'Unknown airline',
                  airlineLogo: firstLeg.airline_logo ?? option.airline_logo ?? '',
                  price,
                  currency: retryCurrency,
                  departureTime: firstLeg.departure_airport?.time ?? '',
                  arrivalTime: lastLeg?.arrival_airport?.time ?? '',
                  duration: this.formatDuration(option.total_duration ?? 0),
                  stops: (option.flights?.length ?? 1) - 1,
                  deepLinkUrl: retryGoogleUrl,
                };
              }).filter((r): r is FlightResult => r !== null);
            }
          }
        }
      }
      return [];
    }

    console.log('[flights] best_flights:', json.best_flights?.length ?? 0, 'other_flights:', json.other_flights?.length ?? 0);

    const allOptions = [...(json.best_flights ?? []), ...(json.other_flights ?? [])];
    const currency = params.currency ?? 'USD';
    const googleFlightsUrl = json.search_metadata?.google_flights_url ?? '';

    const results: FlightResult[] = allOptions
      .slice(0, 5)
      .map((option): FlightResult | null => {
        const firstLeg = option.flights?.[0];
        if (!firstLeg) return null;

        const price = option.price ?? 0;
        if (params.budget && price > params.budget) return null;

        const airline = firstLeg.airline ?? 'Unknown airline';
        const departureTime = firstLeg.departure_airport?.time ?? '';
        const lastLeg = option.flights?.[option.flights.length - 1];
        const arrivalTime = lastLeg?.arrival_airport?.time ?? '';
        const stops = (option.flights?.length ?? 1) - 1;
        const duration = this.formatDuration(option.total_duration ?? 0);

        return {
          airline,
          airlineLogo: firstLeg.airline_logo ?? option.airline_logo ?? '',
          price,
          currency,
          departureTime,
          arrivalTime,
          duration,
          stops,
          deepLinkUrl: googleFlightsUrl,
        };
      })
      .filter((r): r is FlightResult => r !== null);

    return results;
  }
}
