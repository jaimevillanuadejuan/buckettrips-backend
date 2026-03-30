import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FlightResult } from './flight-result.dto';

const SERP_API_URL = 'https://serpapi.com/search.json';
const SERP_AUTOCOMPLETE_URL = 'https://serpapi.com/search.json';
const REST_COUNTRIES_URL =
  'https://restcountries.com/v3.1/all?fields=name,cca2,cca3,altSpellings,capital';
const GEODB_CITIES_URL =
  'https://geodb-free-service.wirefreethought.com/v1/geo/cities';

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
  duration?: number;
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
  total_duration?: number;
  carbon_emissions?: { this_flight?: number };
  price?: number;
  type?: string;
  airline_logo?: string;
  departure_token?: string;
  layovers?: Array<{
    duration?: number;
    name?: string;
    id?: string;
    overnight?: boolean;
  }>;
  booking_token?: string;
}

interface SerpFlightsResponse {
  best_flights?: SerpFlightOption[];
  other_flights?: SerpFlightOption[];
  search_metadata?: { google_flights_url?: string };
  error?: string;
}

interface RestCountryRecord {
  name?: {
    common?: string;
    official?: string;
  };
  cca2?: string;
  cca3?: string;
  altSpellings?: string[];
  capital?: string[];
}

interface GeoDbCitiesResponse {
  data?: Array<{
    countryCode?: string;
  }>;
}

@Injectable()
export class FlightsService {
  private readonly serpApiKey: string;
  private readonly countryAliasToCca2 = new Map<string, string>();
  private readonly countryCodeToCapital = new Map<string, string>();
  private readonly countryCca3ToCca2 = new Map<string, string>();
  private readonly cityToCountryCode = new Map<string, string | null>();
  private readonly cityLookupPromises = new Map<
    string,
    Promise<string | null>
  >();
  private countryCatalogPromise: Promise<void> | null = null;
  private countryCatalogLoaded = false;

  constructor(private readonly config: ConfigService) {
    this.serpApiKey = config.get<string>('SERP_API_KEY') ?? '';
  }

  private normalizeLookupKey(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  private buildGenericBookingUrl(
    origin: string,
    destination: string,
    departureDate: string,
    currency: string,
  ): string {
    const query = encodeURIComponent(
      `${origin} to ${destination} ${departureDate}`,
    );
    return `https://www.google.com/travel/flights?q=${query}&curr=${encodeURIComponent(currency)}`;
  }

  private addCountryAlias(alias: string, cca2: string): void {
    const key = this.normalizeLookupKey(alias);
    if (!key) return;
    this.countryAliasToCca2.set(key, cca2);
  }

  private async ensureCountryCatalogLoaded(): Promise<void> {
    if (this.countryCatalogLoaded) return;

    if (this.countryCatalogPromise) {
      await this.countryCatalogPromise;
      return;
    }

    this.countryCatalogPromise = (async () => {
      try {
        const res = await fetch(REST_COUNTRIES_URL, { cache: 'no-store' });
        if (!res.ok) {
          console.warn(
            `[flights] Failed to load country catalog: HTTP ${res.status}`,
          );
          return;
        }

        const countries = (await res.json()) as RestCountryRecord[];
        for (const country of countries) {
          const cca2 = country.cca2?.toLowerCase();
          const cca3 = country.cca3?.toUpperCase();
          if (!cca2) continue;

          this.addCountryAlias(country.cca2 ?? '', cca2);
          this.addCountryAlias(country.name?.common ?? '', cca2);
          this.addCountryAlias(country.name?.official ?? '', cca2);

          for (const alias of country.altSpellings ?? []) {
            this.addCountryAlias(alias, cca2);
          }

          if (cca3) {
            this.countryCca3ToCca2.set(cca3, cca2);
            this.addCountryAlias(cca3, cca2);
          }

          const capital = country.capital?.[0]?.trim();
          if (capital) {
            this.countryCodeToCapital.set(cca2, capital);
            this.addCountryAlias(capital, cca2);
          }
        }

        this.countryCatalogLoaded = true;
      } catch (error) {
        console.warn('[flights] Country catalog lookup failed:', error);
      } finally {
        this.countryCatalogPromise = null;
      }
    })();

    await this.countryCatalogPromise;
  }

  private getCountryCandidates(value: string): string[] {
    const trimmed = value.trim();
    if (!trimmed) return [];

    const commaParts = trimmed
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

    return Array.from(new Set([trimmed, ...commaParts]));
  }

  private async resolveCountryCodeFromLocation(
    value: string,
  ): Promise<string | null> {
    await this.ensureCountryCatalogLoaded();

    for (const candidate of this.getCountryCandidates(value)) {
      const country = this.countryAliasToCca2.get(
        this.normalizeLookupKey(candidate),
      );
      if (country) return country;
    }

    const cityName = value.split(',')[0]?.trim();
    if (!cityName) return null;

    return this.resolveCityCountryCode(cityName);
  }

  private async resolveCityCountryCode(
    cityName: string,
  ): Promise<string | null> {
    const key = this.normalizeLookupKey(cityName);
    if (!key) return null;

    if (this.cityToCountryCode.has(key)) {
      return this.cityToCountryCode.get(key) ?? null;
    }

    const inflight = this.cityLookupPromises.get(key);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const url = new URL(GEODB_CITIES_URL);
        url.searchParams.set('namePrefix', cityName);
        url.searchParams.set('limit', '1');
        url.searchParams.set('sort', '-population');

        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) {
          console.warn(
            `[flights] City lookup failed for "${cityName}": HTTP ${res.status}`,
          );
          this.cityToCountryCode.set(key, null);
          return null;
        }

        const json = (await res.json()) as GeoDbCitiesResponse;
        const countryCode = json.data?.[0]?.countryCode?.toLowerCase() ?? null;
        this.cityToCountryCode.set(key, countryCode);
        return countryCode;
      } catch (error) {
        console.warn(`[flights] City lookup error for "${cityName}":`, error);
        this.cityToCountryCode.set(key, null);
        return null;
      } finally {
        this.cityLookupPromises.delete(key);
      }
    })();

    this.cityLookupPromises.set(key, promise);
    return promise;
  }

  private async inferGoogleMarket(
    origin: string,
    destination: string,
  ): Promise<string> {
    const originCountry = await this.resolveCountryCodeFromLocation(origin);
    if (originCountry) return originCountry;

    const destinationCountry =
      await this.resolveCountryCodeFromLocation(destination);
    if (destinationCountry) return destinationCountry;

    return 'us';
  }

  private async resolveCapitalFallbackCity(
    destinationId: string,
    destinationText: string,
  ): Promise<string | null> {
    await this.ensureCountryCatalogLoaded();

    const directCountry =
      await this.resolveCountryCodeFromLocation(destinationText);
    if (directCountry) {
      return this.countryCodeToCapital.get(directCountry) ?? null;
    }

    const upperId = destinationId.trim().toUpperCase();
    if (upperId.length === 2) {
      return this.countryCodeToCapital.get(upperId.toLowerCase()) ?? null;
    }

    if (upperId.length === 3) {
      const cca2 = this.countryCca3ToCca2.get(upperId);
      if (cca2) {
        return this.countryCodeToCapital.get(cca2) ?? null;
      }
    }

    return null;
  }

  private mapOptionsToResults(params: {
    options: SerpFlightOption[];
    currency: string;
    budget?: number;
    googleFlightsUrl: string;
  }): FlightResult[] {
    return params.options
      .slice(0, 5)
      .map((option): FlightResult | null => {
        const firstLeg = option.flights?.[0];
        if (!firstLeg) return null;

        const price = option.price ?? 0;
        if (params.budget && price > params.budget) return null;

        const lastLeg = option.flights?.[option.flights.length - 1];

        return {
          airline: firstLeg.airline ?? 'Unknown airline',
          airlineLogo: firstLeg.airline_logo ?? option.airline_logo ?? '',
          price,
          currency: params.currency,
          departureTime: firstLeg.departure_airport?.time ?? '',
          arrivalTime: lastLeg?.arrival_airport?.time ?? '',
          duration: this.formatDuration(option.total_duration ?? 0),
          stops: (option.flights?.length ?? 1) - 1,
          deepLinkUrl: params.googleFlightsUrl,
        };
      })
      .filter((result): result is FlightResult => result !== null);
  }

  private async resolveToIata(
    location: string,
    market: string,
  ): Promise<string> {
    if (/^[A-Z]{2,3}$/.test(location.trim())) {
      return location.trim();
    }

    const query = location.split(',')[0].trim();

    try {
      const url = new URL(SERP_AUTOCOMPLETE_URL);
      url.searchParams.set('engine', 'google_flights_autocomplete');
      url.searchParams.set('api_key', this.serpApiKey);
      url.searchParams.set('q', query);
      url.searchParams.set('hl', 'en');
      url.searchParams.set('gl', market);

      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (!res.ok) {
        console.warn(
          `[flights] Autocomplete failed for "${query}": HTTP ${res.status}`,
        );
        return query;
      }

      const json = (await res.json()) as SerpAutocompleteResponse;
      const suggestions = json.suggestions ?? [];

      for (const suggestion of suggestions) {
        const airportId = suggestion.airports?.[0]?.id;
        if (airportId) {
          return airportId;
        }
      }

      for (const suggestion of suggestions) {
        if (suggestion.id && /^[A-Z]{2,3}$/.test(suggestion.id)) {
          return suggestion.id;
        }
      }

      console.warn(
        `[flights] Could not resolve "${query}" to IATA; using raw query`,
      );
      return query;
    } catch (error) {
      console.warn(`[flights] Autocomplete error for "${query}":`, error);
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
      throw new ServiceUnavailableException(
        'Flight search is not configured (missing SERP_API_KEY)',
      );
    }

    const market = await this.inferGoogleMarket(
      params.origin,
      params.destination,
    );

    const [originId, destinationId] = await Promise.all([
      this.resolveToIata(params.origin, market),
      this.resolveToIata(params.destination, market),
    ]);

    const departureDate = params.departureDate.split('T')[0];
    const returnDate = params.returnDate?.split('T')[0];
    const currency = params.currency ?? 'USD';

    const requestUrl = new URL(SERP_API_URL);
    requestUrl.searchParams.set('engine', 'google_flights');
    requestUrl.searchParams.set('api_key', this.serpApiKey);
    requestUrl.searchParams.set('departure_id', originId);
    requestUrl.searchParams.set('arrival_id', destinationId);
    requestUrl.searchParams.set('outbound_date', departureDate);
    if (returnDate) {
      requestUrl.searchParams.set('return_date', returnDate);
      requestUrl.searchParams.set('type', '1');
    } else {
      requestUrl.searchParams.set('type', '2');
    }
    requestUrl.searchParams.set('adults', String(params.adults ?? 1));
    requestUrl.searchParams.set('currency', currency);
    requestUrl.searchParams.set('hl', 'en');
    requestUrl.searchParams.set('gl', market);

    const baseGoogleFlightsUrl = this.buildGenericBookingUrl(
      params.origin,
      params.destination,
      departureDate,
      currency,
    );

    const res = await fetch(requestUrl.toString(), { cache: 'no-store' });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[flights] SerpApi error response:', errText);
      return [];
    }

    const json = (await res.json()) as SerpFlightsResponse;

    const options = [
      ...(json.best_flights ?? []),
      ...(json.other_flights ?? []),
    ];
    const googleFlightsUrl =
      json.search_metadata?.google_flights_url ?? baseGoogleFlightsUrl;

    if (!json.error && options.length > 0) {
      return this.mapOptionsToResults({
        options,
        currency,
        budget: params.budget,
        googleFlightsUrl,
      });
    }

    if (json.error) {
      console.warn('[flights] SerpApi search error:', json.error);
    }

    const fallbackCity = await this.resolveCapitalFallbackCity(
      destinationId,
      params.destination,
    );
    if (!fallbackCity) {
      return [];
    }

    const fallbackDestinationId = await this.resolveToIata(
      fallbackCity,
      market,
    );
    if (!fallbackDestinationId || fallbackDestinationId === destinationId) {
      return [];
    }

    requestUrl.searchParams.set('arrival_id', fallbackDestinationId);

    const retryRes = await fetch(requestUrl.toString(), { cache: 'no-store' });
    if (!retryRes.ok) {
      const retryErrText = await retryRes.text();
      console.error('[flights] SerpApi retry error response:', retryErrText);
      return [];
    }

    const retryJson = (await retryRes.json()) as SerpFlightsResponse;
    if (retryJson.error) {
      console.warn('[flights] SerpApi retry search error:', retryJson.error);
      return [];
    }

    const retryOptions = [
      ...(retryJson.best_flights ?? []),
      ...(retryJson.other_flights ?? []),
    ];
    const retryGoogleFlightsUrl =
      retryJson.search_metadata?.google_flights_url ?? baseGoogleFlightsUrl;

    return this.mapOptionsToResults({
      options: retryOptions,
      currency,
      budget: params.budget,
      googleFlightsUrl: retryGoogleFlightsUrl,
    });
  }
}
