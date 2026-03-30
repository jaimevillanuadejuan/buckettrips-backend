import {
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { FlightResult } from '../flights/flight-result.dto';
import { FlightsService } from '../flights/flights.service';
import type { HotelResult } from '../hotels/hotel-result.dto';
import { HotelsService } from '../hotels/hotels.service';
import { ConfirmTripDto } from './dto/confirm-trip.dto';
import { ConversationDto } from './dto/conversation.dto';

type ConversationStep =
  | 'destination'
  | 'duration'
  | 'companions'
  | 'budget'
  | 'season'
  | 'pace'
  | 'interests'
  | 'exclusions'
  | 'accommodation'
  | 'contextual'
  | 'confirm';

type CompanionType =
  | 'solo'
  | 'couple'
  | 'friends_small'
  | 'friends_group'
  | 'family_with_kids'
  | 'work_trip';

interface OpenRouterErrorPayload {
  error?: {
    message?: string;
    code?: number | string;
  };
}

interface OpenRouterSuccessPayload {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
}

export interface ContextualQuestion {
  id: string;
  question: string;
  answerType: 'yes_no' | 'a_b' | 'free_text';
  options?: string[];
  whyItMatters: string;
}

const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_TIMEOUT_MS = 20_000;
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const REST_COUNTRIES_ENDPOINT =
  'https://restcountries.com/v3.1/all?fields=name,cca2,cca3,altSpellings';
const GEODB_CITIES_ENDPOINT =
  'https://geodb-free-service.wirefreethought.com/v1/geo/cities';
const COUNTRY_CATALOG_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const COUNTRY_CITY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const GEODB_PAGE_LIMIT = 10;
const MAX_FOLLOW_UP_ANSWERS = 8;
const CONVERSATION_STEPS: ConversationStep[] = [
  'destination',
  'duration',
  'companions',
  'budget',
  'season',
  'pace',
  'interests',
  'exclusions',
  'accommodation',
  'contextual',
  'confirm',
];
const INTEREST_OPTIONS = [
  'ancient_ruins',
  'street_food',
  'night_markets',
  'boat_trips',
  'trekking',
  'temples',
  'local_stays',
  'cooking_classes',
  'silence',
  'nightlife',
  'art_galleries',
  'hidden_beaches',
];
const EXCLUSION_OPTIONS = [
  'instagram_crowds',
  'tourist_traps',
  'rushed_transport',
  'buffet_hotels',
  'forced_group_tours',
  'party_scenes',
];

interface DestinationStop {
  stopOrder: number;
  cityName: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  nights: number;
}

interface TripLegPlan {
  legOrder: number;
  fromStopOrder: number;
  toStopOrder: number;
  fromName: string;
  toName: string;
  mode: 'flight' | 'train';
  departureDate: string;
}

interface FlightSuggestionByLeg {
  legOrder: number;
  fromStopOrder: number;
  toStopOrder: number;
  fromName: string;
  toName: string;
  mode: 'flight' | 'train';
  departureDate: string;
  options: FlightResult[];
  adjustedFromDate?: string | null;
  fallbackBookingUrl?: string | null;
}

interface CountryRoutePlan {
  tripScope: 'COUNTRY';
  countryCode: string;
  destinations: DestinationStop[];
  tripLegs: TripLegPlan[];
  routeGeoJson: {
    type: 'Feature';
    geometry: { type: 'LineString'; coordinates: number[][] };
    properties: { countryCode: string };
  };
}

interface CountryCitySeed {
  name: string;
  latitude: number;
  longitude: number;
}

interface RestCountryNamePayload {
  common?: string;
  official?: string;
}

interface RestCountryPayload {
  cca2?: string;
  cca3?: string;
  name?: RestCountryNamePayload;
  altSpellings?: string[];
}

interface GeoDbCityPayload {
  city?: string;
  latitude?: number;
  longitude?: number;
}

interface GeoDbCitiesResponse {
  data?: GeoDbCityPayload[];
}

interface CountryCatalogEntry {
  countryCode: string;
  aliases: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

function getInclusiveTripDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end - start) / msPerDay) + 1;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function distributeIntegers(total: number, buckets: number): number[] {
  const base = Math.floor(total / buckets);
  const remainder = total % buckets;
  return Array.from({ length: buckets }).map((_, index) =>
    index < remainder ? base + 1 : base,
  );
}

function normalizeLookupText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsWholeAlias(haystack: string, alias: string): boolean {
  const normalizedHaystack = ` ${normalizeLookupText(haystack)} `;
  const normalizedAlias = normalizeLookupText(alias);
  if (normalizedAlias.length < 3) {
    return false;
  }
  return normalizedHaystack.includes(` ${normalizedAlias} `);
}

function cleanGeoDbCityName(value: string): string {
  return value
    .replace(/^(metropolitan city of|city of|province of)\s+/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCodeFence(value: string): string {
  const withoutStart = value.replace(/^```(?:json)?\s*/i, '');
  return withoutStart.replace(/\s*```$/i, '').trim();
}

function extractOpenRouterText(payload: OpenRouterSuccessPayload): string {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => part.text ?? '')
      .join('')
      .trim();
  }

  return '';
}

function isConversationStep(value: unknown): value is ConversationStep {
  return (
    typeof value === 'string' &&
    CONVERSATION_STEPS.includes(value as ConversationStep)
  );
}

// Phrases that indicate the model returned a robotic/error-like response
// despite being told not to. We replace these with a natural fallback.
const ROBOTIC_PHRASES = [
  'i hit a snag',
  'i encountered',
  'i apologize',
  "i'm sorry, but",
  'i am sorry',
  "i'm unable",
  'i cannot',
  'as an ai',
  "i'm afraid",
  'unfortunately',
  "i'm having trouble",
  'something went wrong',
  'could you say that again',
];

const SMALL_TALK_FALLBACKS = [
  'Hey! So where are we headed — got a destination in mind?',
  'Doing well, thanks! So, where are we thinking for this trip?',
  'Good! Ready when you are — where do you want to go?',
];

function isRoboticReply(text: string): boolean {
  const lower = text.toLowerCase();
  return ROBOTIC_PHRASES.some((phrase) => lower.includes(phrase));
}

function naturalFallback(utterance: string): string {
  const lower = utterance.toLowerCase().trim();
  const isGreeting =
    /^(hey|hi|hello|what'?s up|how'?s it going|how are you|good morning|good evening|yo)\b/.test(
      lower,
    );
  if (isGreeting) {
    return SMALL_TALK_FALLBACKS[
      Math.floor(Math.random() * SMALL_TALK_FALLBACKS.length)
    ];
  }
  return 'Sorry, I missed that — could you say it again?';
}

function normalizeConversationResponse(
  payload: unknown,
  fallbackStep: ConversationStep,
  utterance: string = '',
): {
  agentReply: string;
  nextStep: ConversationStep;
  tripContextUpdates: Record<string, unknown>;
} {
  if (!isObject(payload)) {
    return {
      agentReply: naturalFallback(utterance),
      nextStep: fallbackStep,
      tripContextUpdates: {},
    };
  }

  let agentReply =
    typeof payload.agentReply === 'string' &&
    payload.agentReply.trim().length > 0
      ? payload.agentReply.trim()
      : naturalFallback(utterance);

  // Safety net: if the model returned a robotic phrase despite instructions, replace it
  if (isRoboticReply(agentReply)) {
    agentReply = naturalFallback(utterance);
  }

  const nextStep = isConversationStep(payload.nextStep)
    ? payload.nextStep
    : fallbackStep;
  const updates = isObject(payload.tripContextUpdates)
    ? payload.tripContextUpdates
    : {};

  return { agentReply, nextStep, tripContextUpdates: updates };
}

function getPathObject(
  source: Record<string, unknown>,
  path: string[],
): Record<string, unknown> | null {
  let current: unknown = source;

  for (const key of path) {
    if (!isObject(current) || !(key in current)) {
      return null;
    }
    current = current[key];
  }

  return isObject(current) ? current : null;
}

function getPathString(
  source: Record<string, unknown>,
  path: string[],
): string {
  let current: unknown = source;

  for (const key of path) {
    if (!isObject(current) || !(key in current)) {
      return '';
    }

    current = current[key];
  }

  return typeof current === 'string' ? current.trim() : '';
}

function getPathNumber(
  source: Record<string, unknown>,
  path: string[],
): number | null {
  let current: unknown = source;

  for (const key of path) {
    if (!isObject(current) || !(key in current)) {
      return null;
    }

    current = current[key];
  }

  if (typeof current === 'number' && Number.isFinite(current)) {
    return current;
  }

  if (typeof current === 'string') {
    const parsed = Number(current);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getPathStringArray(
  source: Record<string, unknown>,
  path: string[],
): string[] {
  let current: unknown = source;

  for (const key of path) {
    if (!isObject(current) || !(key in current)) {
      return [];
    }

    current = current[key];
  }

  if (!Array.isArray(current)) {
    return [];
  }

  return current
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIsoDateString(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const trimmed = value.trim();
  if (isIsoDate(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function parseDestinationStopsFromUnknown(value: unknown): DestinationStop[] {
  if (!Array.isArray(value)) return [];

  const rows: DestinationStop[] = [];

  value.forEach((entry, index) => {
    if (!isObject(entry)) return;

    const cityName =
      typeof entry.cityName === 'string' ? entry.cityName.trim() : '';
    const countryCode =
      typeof entry.countryCode === 'string'
        ? entry.countryCode.trim().toUpperCase()
        : '';
    const latitude = toFiniteNumber(entry.latitude);
    const longitude = toFiniteNumber(entry.longitude);
    const startDate = toIsoDateString(entry.startDate);
    const endDate = toIsoDateString(entry.endDate);
    const stopOrder = toFiniteNumber(entry.stopOrder) ?? index + 1;

    if (
      cityName.length === 0 ||
      countryCode.length === 0 ||
      latitude === null ||
      longitude === null ||
      !startDate ||
      !endDate
    ) {
      return;
    }

    const nightsRaw = toFiniteNumber(entry.nights);
    const nights =
      nightsRaw !== null
        ? nightsRaw
        : Math.max(getInclusiveTripDays(startDate, endDate) - 1, 0);

    rows.push({
      stopOrder,
      cityName,
      countryCode,
      latitude,
      longitude,
      startDate,
      endDate,
      nights,
    });
  });

  return rows.sort((a, b) => a.stopOrder - b.stopOrder);
}

function parseTripLegPlansFromUnknown(
  value: unknown,
  destinations: DestinationStop[],
): TripLegPlan[] {
  const byStopOrder = new Map(
    destinations.map((stop) => [stop.stopOrder, stop]),
  );

  if (!Array.isArray(value)) return [];

  const rows: TripLegPlan[] = [];
  value.forEach((entry, index) => {
    if (!isObject(entry)) return;

    const legOrder = toFiniteNumber(entry.legOrder) ?? index + 1;
    const fromStopOrder = toFiniteNumber(entry.fromStopOrder) ?? index + 1;
    const toStopOrder = toFiniteNumber(entry.toStopOrder) ?? index + 2;
    const fromStop = byStopOrder.get(fromStopOrder);
    const toStop = byStopOrder.get(toStopOrder);

    const fromName =
      typeof entry.fromName === 'string' && entry.fromName.trim().length > 0
        ? entry.fromName.trim()
        : (fromStop?.cityName ?? '');
    const toName =
      typeof entry.toName === 'string' && entry.toName.trim().length > 0
        ? entry.toName.trim()
        : (toStop?.cityName ?? '');

    const mode: 'flight' = 'flight';

    const departureDate =
      toIsoDateString(entry.departureDate) ??
      toStop?.startDate ??
      fromStop?.endDate ??
      null;

    if (!fromName || !toName || !departureDate) return;

    rows.push({
      legOrder,
      fromStopOrder,
      toStopOrder,
      fromName,
      toName,
      mode,
      departureDate,
    });
  });

  return rows.sort((a, b) => a.legOrder - b.legOrder);
}

function buildSequentialTripLegs(
  destinations: DestinationStop[],
): TripLegPlan[] {
  return destinations.slice(0, -1).map((fromStop, index) => {
    const toStop = destinations[index + 1];
    return {
      legOrder: index + 1,
      fromStopOrder: fromStop.stopOrder,
      toStopOrder: toStop.stopOrder,
      fromName: fromStop.cityName,
      toName: toStop.cityName,
      mode: 'flight' as const,
      departureDate: toStop.startDate,
    };
  });
}

function parseRouteGeoJsonFromUnknown(
  value: unknown,
): CountryRoutePlan['routeGeoJson'] | null {
  if (!isObject(value)) return null;
  if (value.type !== 'Feature') return null;

  const geometry = isObject(value.geometry) ? value.geometry : null;
  if (!geometry || geometry.type !== 'LineString') return null;
  if (!Array.isArray(geometry.coordinates)) return null;

  const coordinates = geometry.coordinates
    .map((coord) => {
      if (!Array.isArray(coord) || coord.length < 2) return null;
      const lng = toFiniteNumber(coord[0]);
      const lat = toFiniteNumber(coord[1]);
      if (lng === null || lat === null) return null;
      return [lng, lat];
    })
    .filter((coord): coord is number[] => coord !== null);

  if (coordinates.length < 2) return null;

  const props = isObject(value.properties) ? value.properties : {};
  const countryCode =
    typeof props.countryCode === 'string' && props.countryCode.trim().length > 0
      ? props.countryCode.trim().toUpperCase()
      : 'XX';

  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { countryCode },
  };
}

function extractTravelRangeFromDailyItinerary(
  value: unknown,
): { startDate: string; endDate: string } | null {
  if (!Array.isArray(value)) return null;

  const dates = value
    .map((entry) => (isObject(entry) ? toIsoDateString(entry.date) : null))
    .filter((entry): entry is string => Boolean(entry))
    .sort();

  if (dates.length === 0) return null;

  return {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
  };
}

function looksLikeItineraryPayload(
  value: unknown,
): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  if (!isObject(value.tripOverview)) return false;
  return Array.isArray(value.dailyItinerary);
}

function normalizeCompanionType(value: string): CompanionType | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'solo' ||
    normalized === 'couple' ||
    normalized === 'friends_small' ||
    normalized === 'friends_group' ||
    normalized === 'family_with_kids' ||
    normalized === 'work_trip'
  ) {
    return normalized;
  }
  return null;
}

function defaultCompanionCount(type: CompanionType): number {
  switch (type) {
    case 'solo':
      return 1;
    case 'couple':
      return 2;
    case 'friends_small':
      return 4;
    case 'friends_group':
      return 7;
    case 'family_with_kids':
      return 4;
    case 'work_trip':
      return 2;
    default:
      return 2;
  }
}

function parseCompanionsFromUtterance(
  utterance: string,
): { type: CompanionType; count: number; children: boolean } | null {
  const lower = utterance.toLowerCase();

  if (
    /\b(just me|solo|alone|by myself|on my own|only me)\b/.test(lower) &&
    !/\bwith\b/.test(lower)
  ) {
    return { type: 'solo', count: 1, children: false };
  }

  if (
    /\b(me and my (partner|wife|husband|boyfriend|girlfriend|fiance|fiancee)|as a couple|with my partner|with my wife|with my husband)\b/.test(
      lower,
    )
  ) {
    return { type: 'couple', count: 2, children: false };
  }

  if (
    /\b(family|kids|children|with my son|with my daughter|with the kids)\b/.test(
      lower,
    )
  ) {
    return { type: 'family_with_kids', count: 4, children: true };
  }

  if (
    /\b(work trip|business trip|colleagues|coworkers|co-workers|team trip)\b/.test(
      lower,
    )
  ) {
    return { type: 'work_trip', count: 2, children: false };
  }

  if (/\b(group of friends|big group|large group|with friends)\b/.test(lower)) {
    const isLargeGroup = /\b(group of|big group|large group)\b/.test(lower);
    const type: CompanionType = isLargeGroup
      ? 'friends_group'
      : 'friends_small';
    return { type, count: defaultCompanionCount(type), children: false };
  }

  return null;
}

function resolveCompanionFromContext(
  source: Record<string, unknown>,
): { type: CompanionType; count: number; children: boolean } | null {
  const companions = getPathObject(source, ['companions']);
  if (!companions) return null;

  const typeRaw = getPathString(source, ['companions', 'type']);
  const type = normalizeCompanionType(typeRaw);
  if (!type) return null;

  const count =
    getPathNumber(source, ['companions', 'count']) ??
    defaultCompanionCount(type);
  const children = Boolean(companions.children);

  return { type, count, children };
}

function getPathStringFromSources(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
  path: string[],
): string {
  const fromPrimary = getPathString(primary, path);
  if (fromPrimary.length > 0) {
    return fromPrimary;
  }
  return getPathString(secondary, path);
}

function resolveFirstRequiredStep(
  baseContext: Record<string, unknown>,
  updates: Record<string, unknown>,
): ConversationStep | null {
  const destinationKnown =
    getPathStringFromSources(updates, baseContext, [
      'destination',
      'resolved_region',
    ]).length > 0 ||
    getPathStringFromSources(updates, baseContext, ['destination', 'raw_input'])
      .length > 0;
  if (!destinationKnown) return 'destination';

  const hasStartDate =
    getPathStringFromSources(updates, baseContext, [
      'travel_dates',
      'exact_start',
    ]).length > 0;
  const hasEndDate =
    getPathStringFromSources(updates, baseContext, [
      'travel_dates',
      'exact_end',
    ]).length > 0;
  if (!hasStartDate || !hasEndDate) return 'duration';

  const companionsInUpdates = resolveCompanionFromContext(updates);
  const companionsInContext = resolveCompanionFromContext(baseContext);
  if (!companionsInUpdates && !companionsInContext) return 'companions';

  const budgetTier = getPathStringFromSources(updates, baseContext, [
    'budget',
    'tier',
  ]).toLowerCase();
  if (!budgetTier) return 'budget';

  return null;
}

function replyAsksCompanions(reply: string): boolean {
  const lower = reply.toLowerCase();
  return (
    /\btravel(ing)? (solo|alone|with)\b/.test(lower) ||
    /\bwho are you travel(ing)? with\b/.test(lower) ||
    /\bwith someone\b/.test(lower) ||
    /\bwith a partner\b/.test(lower) ||
    /\bpartner\b/.test(lower)
  );
}

function companionPhrase(type: CompanionType): string {
  switch (type) {
    case 'solo':
      return 'solo';
    case 'couple':
      return 'as a couple';
    case 'friends_small':
      return 'with a few friends';
    case 'friends_group':
      return 'with a larger friend group';
    case 'family_with_kids':
      return 'with family and kids';
    case 'work_trip':
      return 'for a work trip';
    default:
      return 'with your group';
  }
}

function buildChecklistPrompt(
  step: ConversationStep | null,
  companionType: CompanionType,
): { agentReply: string; nextStep: ConversationStep } {
  if (step === 'duration') {
    return {
      agentReply: `Perfect, noted that you're traveling ${companionPhrase(companionType)}. What dates should I lock in?`,
      nextStep: 'duration',
    };
  }

  if (step === 'budget') {
    return {
      agentReply: `Great, got it - traveling ${companionPhrase(companionType)}. What's your overall trip budget range?`,
      nextStep: 'budget',
    };
  }

  if (step === 'destination') {
    return {
      agentReply: `Great, got it - traveling ${companionPhrase(companionType)}. Which destination should we plan around?`,
      nextStep: 'destination',
    };
  }

  return {
    agentReply: `Perfect, I've locked that you're traveling ${companionPhrase(companionType)}. Ready for me to generate your itinerary?`,
    nextStep: 'confirm',
  };
}

function enforceCompanionConsistency(
  response: {
    agentReply: string;
    nextStep: ConversationStep;
    tripContextUpdates: Record<string, unknown>;
  },
  payload: ConversationDto,
): {
  agentReply: string;
  nextStep: ConversationStep;
  tripContextUpdates: Record<string, unknown>;
} {
  const updates = { ...response.tripContextUpdates };
  const explicitCompanions = parseCompanionsFromUtterance(
    payload.lastUserUtterance,
  );

  if (explicitCompanions) {
    updates.companions = explicitCompanions;
  }

  const knownCompanions =
    resolveCompanionFromContext(updates) ??
    resolveCompanionFromContext(payload.tripContext);

  if (!knownCompanions) {
    return { ...response, tripContextUpdates: updates };
  }

  const requiredStep = resolveFirstRequiredStep(payload.tripContext, updates);
  const asksCompanionsAgain =
    response.nextStep === 'companions' ||
    replyAsksCompanions(response.agentReply);

  if (!asksCompanionsAgain) {
    return { ...response, tripContextUpdates: updates };
  }

  const safePrompt = buildChecklistPrompt(requiredStep, knownCompanions.type);

  return {
    agentReply: safePrompt.agentReply,
    nextStep: safePrompt.nextStep,
    tripContextUpdates: updates,
  };
}

@Injectable()
export class TripConversationService {
  private countryCatalogCache: {
    expiresAt: number;
    entries: CountryCatalogEntry[];
  } | null = null;

  private readonly countryCityCache = new Map<
    string,
    { expiresAt: number; cities: CountryCitySeed[] }
  >();

  constructor(
    private readonly flightsService: FlightsService,
    private readonly hotelsService: HotelsService,
  ) {}

  private async loadCountryCatalog(): Promise<CountryCatalogEntry[]> {
    if (
      this.countryCatalogCache &&
      this.countryCatalogCache.expiresAt > Date.now()
    ) {
      return this.countryCatalogCache.entries;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      const res = await fetch(REST_COUNTRIES_ENDPOINT, {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`REST Countries HTTP ${res.status}`);
      }

      const json = (await res.json()) as RestCountryPayload[];
      const entries = json
        .map((country) => {
          const code =
            typeof country.cca2 === 'string' && country.cca2.trim().length === 2
              ? country.cca2.trim().toUpperCase()
              : null;
          if (!code) return null;

          const aliasSet = new Set<string>();
          if (typeof country.name?.common === 'string')
            aliasSet.add(country.name.common);
          if (typeof country.name?.official === 'string')
            aliasSet.add(country.name.official);
          if (Array.isArray(country.altSpellings)) {
            country.altSpellings.forEach((alias) => {
              if (typeof alias === 'string' && alias.trim().length > 0) {
                aliasSet.add(alias);
              }
            });
          }
          if (
            typeof country.cca3 === 'string' &&
            country.cca3.trim().length === 3
          ) {
            aliasSet.add(country.cca3.toUpperCase());
          }
          aliasSet.add(code);

          return {
            countryCode: code,
            aliases: [...aliasSet],
          } satisfies CountryCatalogEntry;
        })
        .filter((entry): entry is CountryCatalogEntry => entry !== null);

      this.countryCatalogCache = {
        entries,
        expiresAt: Date.now() + COUNTRY_CATALOG_CACHE_TTL_MS,
      };
      return entries;
    } catch {
      this.countryCatalogCache = {
        entries: [],
        expiresAt: Date.now() + 10 * 60 * 1000,
      };
      return [];
    }
  }

  private async detectCountryCodeFromText(
    text: string,
  ): Promise<string | null> {
    const explicitCode = text.match(/\b[A-Z]{2}\b/)?.[0];
    if (explicitCode) {
      return explicitCode.toUpperCase();
    }

    const catalog = await this.loadCountryCatalog();
    let bestMatch: { code: string; score: number } | null = null;

    for (const entry of catalog) {
      for (const alias of entry.aliases) {
        if (!containsWholeAlias(text, alias)) continue;
        const score = normalizeLookupText(alias).length;
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { code: entry.countryCode, score };
        }
      }
    }

    return bestMatch?.code ?? null;
  }

  private async fetchCountryCitiesByCode(
    countryCode: string,
    requiredStops: number,
  ): Promise<CountryCitySeed[] | null> {
    const normalizedCode = countryCode.trim().toUpperCase();
    const cached = this.countryCityCache.get(normalizedCode);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.cities.length >= 2 ? cached.cities : null;
    }

    const targetCount = Math.max(requiredStops + 2, 8);

    try {
      const rows: CountryCitySeed[] = [];
      const seen = new Set<string>();
      let offset = 0;

      while (rows.length < targetCount && offset <= 30) {
        const url = new URL(GEODB_CITIES_ENDPOINT);
        url.searchParams.set('countryIds', normalizedCode);
        url.searchParams.set('types', 'CITY');
        url.searchParams.set('sort', '-population');
        url.searchParams.set('limit', String(GEODB_PAGE_LIMIT));
        url.searchParams.set('offset', String(offset));

        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) {
          break;
        }

        const json = (await res.json()) as GeoDbCitiesResponse;
        const data = Array.isArray(json.data) ? json.data : [];
        if (data.length === 0) break;

        data.forEach((city) => {
          if (typeof city.city !== 'string') return;
          const latitude =
            typeof city.latitude === 'number' && Number.isFinite(city.latitude)
              ? city.latitude
              : null;
          const longitude =
            typeof city.longitude === 'number' &&
            Number.isFinite(city.longitude)
              ? city.longitude
              : null;
          if (latitude === null || longitude === null) return;

          const cleaned = cleanGeoDbCityName(city.city);
          if (cleaned.length < 3) return;
          const dedupeKey = normalizeLookupText(cleaned);
          if (!dedupeKey || seen.has(dedupeKey)) return;
          seen.add(dedupeKey);

          rows.push({
            name: cleaned,
            latitude,
            longitude,
          });
        });

        offset += GEODB_PAGE_LIMIT;
      }

      if (rows.length >= 2) {
        const cities = rows.slice(0, Math.max(requiredStops, 2));
        this.countryCityCache.set(normalizedCode, {
          cities,
          expiresAt: Date.now() + COUNTRY_CITY_CACHE_TTL_MS,
        });
        return cities;
      }
    } catch {
      // fall back below
    }

    this.countryCityCache.set(normalizedCode, {
      cities: [],
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return null;
  }

  private buildFlightFallbackBookingUrl(
    origin: string,
    destination: string,
    departureDate: string,
    currencyCode: string,
  ): string {
    const query = encodeURIComponent(
      `${origin} to ${destination} ${departureDate}`,
    );
    const currency = encodeURIComponent(currencyCode.toUpperCase());
    return `https://www.google.com/travel/flights?q=${query}&curr=${currency}`;
  }

  private buildRailFallbackBookingUrl(
    origin: string,
    destination: string,
    departureDate: string,
  ): string {
    const query = encodeURIComponent(
      `${origin} to ${destination} train ${departureDate}`,
    );
    return `https://www.google.com/search?q=${query}`;
  }

  private async searchFlightsWithDateFlex(params: {
    origin: string;
    destination: string;
    departureDate: string;
    budget?: number;
    currency: string;
    adults: number;
  }): Promise<{
    options: FlightResult[];
    departureDate: string;
    adjustedFromDate: string | null;
  }> {
    const offsets = [0, 1, -1, 2, -2, 3, -3];
    const budgetPasses =
      params.budget !== undefined ? [params.budget, undefined] : [undefined];

    for (const budget of budgetPasses) {
      for (const offset of offsets) {
        const candidateDate =
          offset === 0
            ? params.departureDate
            : addDays(params.departureDate, offset);

        try {
          const options = await this.flightsService.searchFlights({
            origin: params.origin,
            destination: params.destination,
            departureDate: candidateDate,
            budget,
            currency: params.currency,
            adults: params.adults,
          });

          if (options.length > 0) {
            return {
              options: options.slice(0, 3),
              departureDate: candidateDate,
              adjustedFromDate:
                candidateDate === params.departureDate
                  ? null
                  : params.departureDate,
            };
          }
        } catch {
          // keep trying nearby dates and fallback budget pass
        }
      }
    }

    return {
      options: [],
      departureDate: params.departureDate,
      adjustedFromDate: null,
    };
  }

  private async detectCountryRoutePlan(
    destinationText: string,
    startDate: string,
    tripDays: number,
    countryCodeHint?: string | null,
  ): Promise<CountryRoutePlan | null> {
    const resolvedCountryCode =
      (countryCodeHint && countryCodeHint.trim().length > 0
        ? countryCodeHint.trim().toUpperCase()
        : null) ?? (await this.detectCountryCodeFromText(destinationText));

    if (!resolvedCountryCode) return null;

    const maxStops = Math.min(
      tripDays <= 4
        ? 2
        : tripDays <= 8
          ? 3
          : tripDays <= 12
            ? 4
            : tripDays <= 16
              ? 5
              : 6,
    );

    const stopCount = Math.max(2, maxStops);
    const dynamicCities = await this.fetchCountryCitiesByCode(
      resolvedCountryCode,
      stopCount,
    );
    if (!dynamicCities || dynamicCities.length < 2) {
      return null;
    }

    const selectedCities = dynamicCities.slice(0, stopCount);
    const dayDistribution = distributeIntegers(tripDays, stopCount);

    let cursor = startDate;
    const destinations: DestinationStop[] = selectedCities.map(
      (city, index) => {
        const daysAtStop = Math.max(1, dayDistribution[index] ?? 1);
        const stopStart = cursor;
        const stopEnd = addDays(cursor, daysAtStop - 1);
        cursor = addDays(stopEnd, 1);

        return {
          stopOrder: index + 1,
          cityName: city.name,
          countryCode: resolvedCountryCode,
          latitude: city.latitude,
          longitude: city.longitude,
          startDate: stopStart,
          endDate: stopEnd,
          nights: Math.max(daysAtStop - 1, 0),
        };
      },
    );

    const tripLegs: TripLegPlan[] = destinations
      .slice(0, -1)
      .map((fromStop, index) => {
        const toStop = destinations[index + 1];
        const mode: 'flight' = 'flight';

        return {
          legOrder: index + 1,
          fromStopOrder: fromStop.stopOrder,
          toStopOrder: toStop.stopOrder,
          fromName: fromStop.cityName,
          toName: toStop.cityName,
          mode,
          departureDate: toStop.startDate,
        };
      });

    return {
      tripScope: 'COUNTRY',
      countryCode: resolvedCountryCode,
      destinations,
      tripLegs,
      routeGeoJson: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: destinations.map((stop) => [
            stop.longitude,
            stop.latitude,
          ]),
        },
        properties: {
          countryCode: resolvedCountryCode,
        },
      },
    };
  }

  private async buildMultiDestinationSuggestions(
    plan: CountryRoutePlan,
    currencyCode: string,
    originCity: string,
    flightBudgetAmount: number | undefined,
    accommodationBudgetAmount: number | undefined,
  ): Promise<{
    flightSuggestionsByLeg: FlightSuggestionByLeg[];
    hotelSuggestionsByDestination: Array<{
      stopOrder: number;
      cityName: string;
      countryCode: string;
      checkIn: string;
      checkOut: string;
      options: HotelResult[];
    }>;
  }> {
    const cleanedOrigin = originCity.trim();
    const firstStop = plan.destinations[0];
    const lastStop = plan.destinations[plan.destinations.length - 1];
    const outboundLeg: TripLegPlan | null =
      cleanedOrigin.length > 0 && firstStop
        ? {
            legOrder: 0,
            fromStopOrder: 0,
            toStopOrder: firstStop.stopOrder,
            fromName: cleanedOrigin,
            toName: firstStop.cityName,
            mode: 'flight',
            departureDate: firstStop.startDate,
          }
        : null;
    const returnLeg: TripLegPlan | null =
      cleanedOrigin.length > 0 && lastStop
        ? {
            legOrder: plan.tripLegs.length + 1,
            fromStopOrder: lastStop.stopOrder,
            toStopOrder: lastStop.stopOrder + 1,
            fromName: lastStop.cityName,
            toName: cleanedOrigin,
            mode: 'flight',
            departureDate: lastStop.endDate,
          }
        : null;

    const suggestionLegs = [
      ...(outboundLeg ? [outboundLeg] : []),
      ...plan.tripLegs,
      ...(returnLeg ? [returnLeg] : []),
    ];

    const flightSuggestionsByLeg = await Promise.all(
      suggestionLegs.map(async (leg) => {
        let options: FlightResult[] = [];
        let effectiveDepartureDate = leg.departureDate;
        let adjustedFromDate: string | null = null;

        const flightResult = await this.searchFlightsWithDateFlex({
          origin: leg.fromName,
          destination: leg.toName,
          departureDate: leg.departureDate,
          budget: flightBudgetAmount,
          currency: currencyCode,
          adults: 1,
        });

        options = flightResult.options.map((option) => ({
          ...option,
          deepLinkUrl:
            typeof option.deepLinkUrl === 'string' &&
            option.deepLinkUrl.trim().length > 0
              ? option.deepLinkUrl
              : this.buildFlightFallbackBookingUrl(
                  leg.fromName,
                  leg.toName,
                  flightResult.departureDate,
                  currencyCode,
                ),
        }));
        effectiveDepartureDate = flightResult.departureDate;
        adjustedFromDate = flightResult.adjustedFromDate;

        return {
          legOrder: leg.legOrder,
          fromStopOrder: leg.fromStopOrder,
          toStopOrder: leg.toStopOrder,
          fromName: leg.fromName,
          toName: leg.toName,
          mode: leg.mode,
          departureDate: effectiveDepartureDate,
          options: options.slice(0, 3),
          adjustedFromDate,
          fallbackBookingUrl:
            leg.mode === 'flight'
              ? this.buildFlightFallbackBookingUrl(
                  leg.fromName,
                  leg.toName,
                  effectiveDepartureDate,
                  currencyCode,
                )
              : this.buildRailFallbackBookingUrl(
                  leg.fromName,
                  leg.toName,
                  effectiveDepartureDate,
                ),
        };
      }),
    );

    const hotelSuggestionsByDestination = await Promise.all(
      plan.destinations.map(async (destination) => {
        let options: HotelResult[] = [];

        const checkOut =
          destination.startDate === destination.endDate
            ? addDays(destination.endDate, 1)
            : destination.endDate;

        try {
          options = await this.hotelsService.searchHotels({
            destination: `${destination.cityName}, ${destination.countryCode}`,
            checkIn: destination.startDate,
            checkOut,
            budget: accommodationBudgetAmount,
            currency: currencyCode,
            guests: 2,
          });
        } catch {
          options = [];
        }

        return {
          stopOrder: destination.stopOrder,
          cityName: destination.cityName,
          countryCode: destination.countryCode,
          checkIn: destination.startDate,
          checkOut,
          options: options.slice(0, 5),
        };
      }),
    );

    return { flightSuggestionsByLeg, hotelSuggestionsByDestination };
  }

  private extractOriginCityFromItinerary(
    itinerary: Record<string, unknown>,
  ): string {
    const directOrigin =
      typeof itinerary.originCity === 'string'
        ? itinerary.originCity.trim()
        : '';
    if (directOrigin.length > 0) return directOrigin;

    const destinations = parseDestinationStopsFromUnknown(
      itinerary.destinations,
    );
    const maxStopOrder = destinations.reduce(
      (max, stop) => (stop.stopOrder > max ? stop.stopOrder : max),
      0,
    );

    const flightGroups = Array.isArray(itinerary.flightSuggestionsByLeg)
      ? itinerary.flightSuggestionsByLeg
      : [];

    for (const entry of flightGroups) {
      if (!isObject(entry)) continue;
      const fromStopOrder = toFiniteNumber(entry.fromStopOrder);
      const legOrder = toFiniteNumber(entry.legOrder);
      const fromName =
        typeof entry.fromName === 'string' ? entry.fromName.trim() : '';
      const toStopOrder = toFiniteNumber(entry.toStopOrder);
      const toName =
        typeof entry.toName === 'string' ? entry.toName.trim() : '';

      if (fromName.length === 0) continue;
      if (fromStopOrder === 0 || legOrder === 0) {
        return fromName;
      }
      if (
        toName.length > 0 &&
        toStopOrder !== null &&
        maxStopOrder > 0 &&
        toStopOrder > maxStopOrder
      ) {
        return toName;
      }
    }

    return '';
  }

  private extractBudgetAmount(
    itinerary: Record<string, unknown>,
    key: 'flightBudget' | 'accommodationBudget',
  ): number | undefined {
    if (!isObject(itinerary[key])) return undefined;
    const amount = toFiniteNumber(itinerary[key].amount);
    return amount !== null ? amount : undefined;
  }

  private async inferCountryRoutePlanFromItinerary(
    itinerary: Record<string, unknown>,
  ): Promise<CountryRoutePlan | null> {
    const overview = isObject(itinerary.tripOverview)
      ? itinerary.tripOverview
      : {};
    const scopeRaw =
      typeof overview.tripScope === 'string'
        ? overview.tripScope.trim().toUpperCase()
        : 'CITY';
    const destinations = parseDestinationStopsFromUnknown(
      itinerary.destinations,
    );
    const inferredCountryCode =
      typeof overview.countryCode === 'string' &&
      overview.countryCode.trim().length > 0
        ? overview.countryCode.trim().toUpperCase()
        : (destinations[0]?.countryCode ?? null);

    if (destinations.length >= 2 && inferredCountryCode) {
      const parsedLegs = parseTripLegPlansFromUnknown(
        itinerary.tripLegs,
        destinations,
      );
      const tripLegs =
        parsedLegs.length > 0
          ? parsedLegs
          : buildSequentialTripLegs(destinations);

      const parsedRoute = parseRouteGeoJsonFromUnknown(itinerary.routeGeoJson);
      const routeGeoJson = parsedRoute ?? {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: destinations.map((stop) => [
            stop.longitude,
            stop.latitude,
          ]),
        },
        properties: { countryCode: inferredCountryCode },
      };

      return {
        tripScope: 'COUNTRY',
        countryCode: inferredCountryCode,
        destinations,
        tripLegs,
        routeGeoJson,
      };
    }

    if (scopeRaw === 'COUNTRY') {
      const destinationLabel =
        typeof overview.destination === 'string'
          ? overview.destination.trim()
          : '';
      const range = extractTravelRangeFromDailyItinerary(
        itinerary.dailyItinerary,
      );
      if (destinationLabel && range) {
        const tripDays = getInclusiveTripDays(range.startDate, range.endDate);
        return this.detectCountryRoutePlan(
          destinationLabel,
          range.startDate,
          tripDays,
          inferredCountryCode,
        );
      }
    }

    return null;
  }

  private async enforceCountryScopeForRefine(
    previousItinerary: Record<string, unknown>,
    refinedItinerary: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const previousOverview = isObject(previousItinerary.tripOverview)
      ? previousItinerary.tripOverview
      : {};
    const nextOverview = isObject(refinedItinerary.tripOverview)
      ? refinedItinerary.tripOverview
      : {};

    const previousScope =
      typeof previousOverview.tripScope === 'string'
        ? previousOverview.tripScope.trim().toUpperCase()
        : 'CITY';
    const nextScope =
      typeof nextOverview.tripScope === 'string'
        ? nextOverview.tripScope.trim().toUpperCase()
        : 'CITY';

    const shouldBeCountry =
      previousScope === 'COUNTRY' ||
      nextScope === 'COUNTRY' ||
      parseDestinationStopsFromUnknown(refinedItinerary.destinations).length >
        1;

    if (!shouldBeCountry) {
      return refinedItinerary;
    }

    const plan =
      (await this.inferCountryRoutePlanFromItinerary(refinedItinerary)) ??
      (await this.inferCountryRoutePlanFromItinerary(previousItinerary));

    if (!plan) {
      return {
        ...refinedItinerary,
        tripOverview: {
          ...previousOverview,
          ...nextOverview,
          tripScope: 'COUNTRY',
          countryCode:
            typeof nextOverview.countryCode === 'string'
              ? nextOverview.countryCode.trim().toUpperCase()
              : typeof previousOverview.countryCode === 'string'
                ? previousOverview.countryCode.trim().toUpperCase()
                : null,
        },
      };
    }

    const currencyCode =
      typeof nextOverview.currencyCode === 'string' &&
      nextOverview.currencyCode.trim().length > 0
        ? nextOverview.currencyCode.trim().toUpperCase()
        : typeof previousOverview.currencyCode === 'string' &&
            previousOverview.currencyCode.trim().length > 0
          ? previousOverview.currencyCode.trim().toUpperCase()
          : 'USD';

    const originCity =
      this.extractOriginCityFromItinerary(refinedItinerary) ||
      this.extractOriginCityFromItinerary(previousItinerary);

    const flightBudgetAmount =
      this.extractBudgetAmount(refinedItinerary, 'flightBudget') ??
      this.extractBudgetAmount(previousItinerary, 'flightBudget');
    const accommodationBudgetAmount =
      this.extractBudgetAmount(refinedItinerary, 'accommodationBudget') ??
      this.extractBudgetAmount(previousItinerary, 'accommodationBudget');

    const suggestions = await this.buildMultiDestinationSuggestions(
      plan,
      currencyCode,
      originCity,
      flightBudgetAmount,
      accommodationBudgetAmount,
    );

    return {
      ...refinedItinerary,
      tripOverview: {
        ...previousOverview,
        ...nextOverview,
        tripScope: 'COUNTRY',
        countryCode: plan.countryCode,
      },
      destinations: plan.destinations,
      tripLegs: plan.tripLegs,
      routeGeoJson: plan.routeGeoJson,
      flightSuggestionsByLeg: suggestions.flightSuggestionsByLeg,
      hotelSuggestionsByDestination: suggestions.hotelSuggestionsByDestination,
    };
  }

  async parseIntent(rawInput: string) {
    const input = rawInput.trim();
    const lowered = input.toLowerCase();
    const detectedCountryCode = await this.detectCountryCodeFromText(input);

    let resolvedRegion = 'Flexible destination (to be refined)';
    let confidence = 0.55;

    if (lowered.includes('luang prabang') || lowered.includes('laos')) {
      resolvedRegion = 'Luang Prabang / Northern Laos';
      confidence = 0.92;
    } else if (lowered.includes('southeast asia') || lowered.includes('sea')) {
      resolvedRegion = 'Luang Prabang & Mekong region';
      confidence = 0.87;
    } else if (lowered.includes('japan')) {
      resolvedRegion = 'Kyoto & Kansai region';
      confidence = 0.85;
    } else if (lowered.includes('mediterranean')) {
      resolvedRegion = 'Mediterranean coast (shoulder-season friendly)';
      confidence = 0.78;
    }

    const vibeKeywords = [
      'off-grid',
      'wild',
      'calm',
      'luxury',
      'quiet',
      'adventure',
      'spiritual',
      'food',
    ].filter((keyword) => lowered.includes(keyword));

    const intensity =
      lowered.includes('rough') || lowered.includes('hardcore')
        ? 'high'
        : lowered.includes('relax') || lowered.includes('slow')
          ? 'low'
          : 'medium';

    return {
      destination: {
        raw_input: input,
        resolved_region: resolvedRegion,
        confidence,
      },
      scope: detectedCountryCode ? 'COUNTRY' : 'CITY',
      countryCode: detectedCountryCode,
      extracted: {
        vibe_keywords: vibeKeywords,
        intensity,
      },
    };
  }

  async generateContextualQuestions(
    tripContext: Record<string, unknown>,
    conversationHistory?: Array<{ role: 'user' | 'agent'; text: string }>,
  ) {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Missing GROQ_API_KEY server configuration',
      );
    }

    const historyLines = (conversationHistory ?? [])
      .map((t) => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.text}`)
      .join('\n');

    const systemPrompt = [
      'You are a sharp, warm travel advisor reviewing a trip profile to decide what — if anything — is still worth asking.',
      'Your job is to generate 1 to 3 highly specific, personalized follow-up questions based ONLY on genuine gaps or ambiguities in the trip context.',
      'Rules:',
      '- Read the full conversation history and trip context carefully.',
      '- NEVER ask about something the user already mentioned, even indirectly.',
      '- NEVER ask generic scripted questions like "do you want a free day?" or "do you prefer fewer transfers?".',
      '- Each question must be directly tied to something specific in their trip — a place they named, a preference they hinted at, a tension in their choices.',
      '- If the context is already rich and complete, return fewer questions or even zero.',
      '- Questions should sound like a real person asking, not a form.',
      '- Output valid JSON only. No markdown, no prose outside the JSON.',
      'Return this exact shape: { "questions": [ { "id": "string", "question": "string", "answerType": "yes_no | a_b | free_text", "options": ["string"] | null, "whyItMatters": "string" } ] }',
    ].join('\n');

    const userPrompt = `Trip context:
${JSON.stringify(tripContext, null, 2)}

Full conversation so far:
${historyLines || '(none)'}

Based on the above, what — if anything — is genuinely still unclear or worth personalizing further?
Return 1-3 questions max. If nothing meaningful is missing, return an empty array.`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
      const res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
        cache: 'no-store',
      });

      const json = (await res.json()) as
        | OpenRouterErrorPayload
        | OpenRouterSuccessPayload;

      if (!res.ok) {
        const msg =
          'error' in json && json.error?.message
            ? json.error.message
            : 'Groq request failed';
        throw new ServiceUnavailableException(`Groq API error: ${msg}`);
      }

      const rawText = extractOpenRouterText(json as OpenRouterSuccessPayload);
      if (!rawText)
        throw new ServiceUnavailableException('No response from Groq');

      const cleaned = stripCodeFence(rawText);
      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        return { questions: [] };
      }

      if (isObject(parsed) && Array.isArray(parsed.questions)) {
        return { questions: parsed.questions };
      }

      return { questions: [] };
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof GatewayTimeoutException
      )
        throw error;
      if (error instanceof Error && error.name === 'AbortError')
        throw new GatewayTimeoutException(
          'Contextual questions request timed out',
        );
      throw new ServiceUnavailableException(
        'Failed to generate contextual questions',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async continueConversation(payload: ConversationDto) {
    const apiKey = process.env.GROQ_API_KEY?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Missing GROQ_API_KEY server configuration',
      );
    }

    const step = isConversationStep(payload.currentStep)
      ? payload.currentStep
      : 'destination';

    const systemPrompt = [
      'You are a warm, witty travel companion having a completely natural conversation to help someone plan a trip.',
      'You MUST always output valid JSON only — no markdown, no prose outside the JSON.',
      'Always return exactly this shape: { "agentReply": string, "nextStep": string, "tripContextUpdates": object }.',
      '',
      'SMALL TALK RULE (highest priority):',
      'If the user greets you, asks how you are, or makes ANY small talk with no trip details, respond like a real person would — warm, casual, brief — then naturally pivot to trip planning.',
      'NEVER say things like "I hit a snag", "I encountered an issue", "I\'m sorry", "I apologize", or any robotic/error-like phrase.',
      'Small talk examples:',
      '"hey" ? agentReply: "Hey! Ready to plan something good — where are we headed?"',
      '"hey how\'s it going" ? agentReply: "Pretty good, thanks! So, where are we thinking for this trip?"',
      '"hi there" ? agentReply: "Hey! Got a destination in mind, or are we still dreaming?"',
      '"what\'s up" ? agentReply: "Not much — just waiting to hear where you want to go. What\'s the plan?"',
      '"how are you" ? agentReply: "Doing well! More importantly — where are we going? Got somewhere in mind?"',
      '',
      'CONTEXT EXTRACTION RULE (critical):',
      'Scan the ENTIRE conversation history AND the current utterance for ANY trip details — destination, duration, companions, budget, dates, interests, places, food preferences, activities.',
      'Example: "I want to go to Ibiza with friends for 2 weeks" ? extract destination=Ibiza, companions.type=friends_small, duration.min=14, duration.max=14.',
      'Example: "just me and my partner" ? companions.type=couple, companions.count=2.',
      'Example: "with a group of friends" ? companions.type=friends_small.',
      'If the user asks to visit a whole country (for example "Italy" or "Japan"), set tripContextUpdates.tripScope = "COUNTRY" and include countryCode when known.',
      'If the user asks for one city, set tripContextUpdates.tripScope = "CITY".',
      'If the user provided multiple details, advance nextStep past all resolved fields to the first unresolved one.',
      '',
      'DO NOT ASK ABOUT THINGS ALREADY MENTIONED (critical):',
      'Before generating agentReply, check the full conversation history and tripContext for everything the user has already told you.',
      'If the user mentioned specific places (e.g. "Fontana di Trevi", "Saint Peters"), foods (e.g. "pasta", "gelato"), or activities — treat those as known interests. Do NOT ask about them again.',
      'If dates, duration, companions, or budget are already in tripContext or were mentioned in conversation — skip those steps entirely.',
      'The contextual step is for asking 1 genuinely unclear thing that would meaningfully change the itinerary. If nothing is unclear, skip straight to confirm.',
      '',
      'ACCOMMODATION QUESTIONS (ask naturally after destination + dates are confirmed):',
      'Once destination and dates are known, ask about accommodation budget alongside or after the flight budget question.',
      'Example: "And roughly how much per night are you thinking for hotels?"',
      'If the user has not mentioned accommodation type preference, optionally ask: "Any preference on the type of place — hotel, hostel, apartment, that kind of thing?"',
      "These are OPTIONAL — if the user skips or says they don't know, move on. Do NOT block progress on these.",
      'When captured, set tripContextUpdates.accommodationBudget = { amount: number, currency: "ISO code" } and tripContextUpdates.accommodationType = "hotel" | "hostel" | "apartment" | "resort" | "guesthouse".',
      '',
      'REQUIRED CHECKLIST — you must collect ALL of these before moving to confirm:',
      '[ ] destination — resolved_region or raw_input is set',
      '[ ] exact_start — a real calendar date in YYYY-MM-DD format',
      '[ ] exact_end — a real calendar date in YYYY-MM-DD format',
      '[ ] companions — type is known (solo / couple / friends_small / friends_group / family_with_kids)',
      '[ ] budget — tier is known (shoestring / thoughtful / comfortable / premium / no_limit)',
      'If ANY item is unchecked, stay on the appropriate step and ask for it. Do NOT advance to confirm.',
      'NOTE: accommodationBudget and accommodationType are NOT in the checklist — they are optional and must never block confirm.',
      '',
      'FLIGHT CONTEXT (optional — ask naturally after the 5 required items are all collected):',
      'Once destination, dates, companions, and budget are all known, ask ONE of these if not already mentioned:',
      `1. Where they're flying from — if a detectedOriginCity is provided, confirm it: e.g. "Are you flying from ${payload.detectedOriginCity ?? 'your city'}?" — if no detectedOriginCity, ask openly: "What city are you flying from?"`,
      '2. Flight budget — e.g. "Roughly how much are you thinking for flights?" or "Do you have a budget in mind for the flights themselves?"',
      '3. Airline preferences — e.g. "Any airlines you love or want to avoid?" (only ask if not already mentioned)',
      "Ask these one at a time, only if the user hasn't already mentioned them. They are OPTIONAL — never block confirm if the user skips them.",
      'Extract and set in tripContextUpdates: originCity (string), flightBudget ({ amount, currency }), airlinePreferences ({ preferred: [], avoided: [] }).',
      `If the user confirms the detected city (e.g. "yes", "yeah", "correct", "that's right"), set originCity to "${payload.detectedOriginCity ?? ''}" in tripContextUpdates.`,
      "If the user says they're driving, taking a train, or doesn't need flights — skip all flight questions entirely.",
      '',
      'DATE CALCULATION RULE:',
      `The current year is ${new Date().getFullYear()}. Today's date is ${new Date().toISOString().split('T')[0]}.`,
      'If the user describes dates in natural language (e.g. "first Saturday of October", "next weekend", "two weeks from now"), calculate the actual YYYY-MM-DD dates yourself and confirm them with the user before setting exact_start/exact_end.',
      `ALWAYS use ${new Date().getFullYear()} as the year unless the user explicitly says "next year", "in 2027", or a specific future year. Never guess a past year.`,
      'Do NOT ask the user to provide the exact dates themselves if you can calculate them. Just say "So that would be [date] to [date] — does that work?" and set the dates in tripContextUpdates.',
      '',
      'CONFIRM STEP RULES (critical — read carefully):',
      'You may ONLY set nextStep to "confirm" when ALL five checklist items above are satisfied.',
      'NEVER set nextStep to "confirm" just because the user said something that sounds like agreement, a calculation request, or a vague go-ahead.',
      'Examples that must NOT trigger confirm: "make the calculations", "sounds good", "sure", "ok", "that works", "yes", "great".',
      'The confirm step means: all required info is collected AND the user has explicitly said they want to generate the itinerary.',
      'Explicit confirm phrases: "let\'s go", "plan it", "yes go ahead", "build the itinerary", "generate it", "do it", "create the trip", "start planning", "make the trip".',
      'If the user says something ambiguous, stay on the current step and ask the next missing question.',
      '',
      'REPLY STYLE:',
      'Keep agentReply to 1-2 sentences max. Acknowledge what was captured, then ask the next missing thing naturally.',
      'When asking for dates, calculate them if possible and confirm with the user.',
      '',
      'Allowed enum values —',
      'companions.type: solo | couple | friends_small | friends_group | family_with_kids | work_trip',
      'budget.tier: shoestring | thoughtful | comfortable | premium | no_limit',
      'travel_dates.season: spring | summer | autumn | winter | shoulder (plus optional moods as comma-separated string)',
    ].join('\n');

    const historyLines = (payload.conversationHistory ?? [])
      .map((t) => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.text}`)
      .join('\n');

    const userPrompt = `Current step: ${step}
User said: """${payload.lastUserUtterance}"""

Full conversation so far (use this to extract ANY context clues you may have missed):
${historyLines || '(no prior turns)'}

Existing trip context JSON (already extracted fields — do NOT regress these):
${JSON.stringify(payload.tripContext)}

Allowed interests:
${INTEREST_OPTIONS.join(', ')}

Allowed exclusions:
${EXCLUSION_OPTIONS.join(', ')}

Return JSON only with shape:
{
  "agentReply": "string",
  "nextStep": "destination | duration | companions | budget | season | pace | interests | exclusions | accommodation | contextual | confirm",
  "tripContextUpdates": {
    "tripScope": "CITY | COUNTRY",
    "countryCode": "ISO country code, or null",
    "destination": { "raw_input": "...", "resolved_region": "...", "confidence": 0.7 },
    "duration": { "min": 7, "max": 10 },
    "companions": { "type": "couple", "count": 2, "children": false },
    "budget": { "tier": "comfortable" },
    "travel_dates": { "season": "summer, low-crowds", "exact_start": "YYYY-MM-DD", "exact_end": "YYYY-MM-DD" },
    "pace": { "activity_level": 0.5, "spontaneity": 0.5 },
    "interests": ["..."],
    "exclusions": ["..."],
    "accommodation": { "style": "City Boutique", "tier": "comfortable" },
    "accommodationBudget": { "amount": 120, "currency": "USD" },
    "accommodationType": "hotel",
    "contextual_answers": { "question_id": "answer" },
    "originCity": "London",
    "flightBudget": { "amount": 300, "currency": "GBP" },
    "airlinePreferences": { "preferred": ["British Airways"], "avoided": ["Ryanair"] },
    "confirmed": false
  }
}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
      const openRouterRes = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.35,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
        cache: 'no-store',
      });

      const openRouterJson = (await openRouterRes.json()) as
        | OpenRouterErrorPayload
        | OpenRouterSuccessPayload;

      if (!openRouterRes.ok) {
        const errorMessage =
          'error' in openRouterJson && openRouterJson.error?.message
            ? openRouterJson.error.message
            : 'OpenRouter request failed';

        if (openRouterRes.status === 408 || openRouterRes.status === 504) {
          throw new GatewayTimeoutException(
            `OpenRouter API timeout: ${errorMessage}`,
          );
        }

        throw new ServiceUnavailableException(
          `OpenRouter API error: ${errorMessage}`,
        );
      }

      const rawText = extractOpenRouterText(
        openRouterJson as OpenRouterSuccessPayload,
      );

      if (!rawText) {
        throw new ServiceUnavailableException(
          'OpenRouter did not return a valid conversation response',
        );
      }

      const cleaned = stripCodeFence(rawText);
      let parsed: unknown = cleaned;

      try {
        parsed = JSON.parse(cleaned);
      } catch {
        // keep string
      }

      const normalizedResponse = normalizeConversationResponse(
        parsed,
        step,
        payload.lastUserUtterance,
      );

      return enforceCompanionConsistency(normalizedResponse, payload);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof GatewayTimeoutException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException('Conversation request timed out');
      }

      throw new ServiceUnavailableException(
        'Failed to generate conversational response',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async chat(payload: {
    message: string;
    history?: Array<{ role: 'user' | 'agent'; text: string }>;
  }) {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Missing GROQ_API_KEY server configuration',
      );
    }

    const systemPrompt = [
      'You are a warm, knowledgeable travel companion — not a booking bot, not a corporate assistant.',
      'You help people with anything travel-related: trip ideas, destination advice, itinerary consulting, packing, budgeting, visa questions, or just chatting about travel.',
      'If the user greets you or makes small talk, respond like a real person — casual, warm, brief — then naturally bring up travel if it fits.',
      'NEVER say "I hit a snag", "I apologize", "I\'m sorry but", "as an AI", "I\'m unable to", or any robotic phrase.',
      'Small talk examples:',
      '"hey" ? "Hey! Got a trip on your mind, or just browsing?"',
      '"how\'s it going" ? "Pretty good! You planning something or just dreaming about it?"',
      '"what can you do" ? "Pretty much anything travel — where to go, when to go, what to pack, how to budget. What\'s on your mind?"',
      'Keep replies concise — 2 to 4 sentences — unless the user asks for detail.',
      "If the user wants to plan a full trip, guide them naturally: ask about destination, dates, who they're going with, and budget — one question at a time.",
      'Never ask multiple questions in one reply.',
    ].join(' ');

    const historyLines = (payload.history ?? [])
      .map((t) => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.text}`)
      .join('\n');

    const userPrompt = historyLines
      ? `Conversation so far:\n${historyLines}\n\nUser: ${payload.message}`
      : `User: ${payload.message}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
      const res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.7,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
        cache: 'no-store',
      });

      const json = (await res.json()) as
        | OpenRouterErrorPayload
        | OpenRouterSuccessPayload;

      if (!res.ok) {
        const msg =
          'error' in json && json.error?.message
            ? json.error.message
            : 'OpenRouter request failed';
        throw new ServiceUnavailableException(`OpenRouter API error: ${msg}`);
      }

      let reply = extractOpenRouterText(json as OpenRouterSuccessPayload);

      if (!reply || isRoboticReply(reply)) {
        reply = naturalFallback(payload.message);
      }

      return { reply };
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof GatewayTimeoutException
      )
        throw error;
      if (error instanceof Error && error.name === 'AbortError')
        throw new GatewayTimeoutException('Chat request timed out');
      throw new ServiceUnavailableException('Failed to generate chat response');
    } finally {
      clearTimeout(timeout);
    }
  }

  async refineTrip(payload: {
    itinerary: Record<string, unknown>;
    message: string;
    history?: Array<{ role: 'user' | 'agent'; text: string }>;
  }) {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey)
      throw new ServiceUnavailableException(
        'Missing GROQ_API_KEY server configuration',
      );

    const historyLines = (payload.history ?? [])
      .map((t) => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.text}`)
      .join('\n');

    const systemPrompt = [
      'You are a warm travel advisor helping refine an existing trip itinerary based on user feedback.',
      'The user will describe a change they want. You MUST return a JSON object with two keys: "reply" and "itinerary".',
      '"reply" is a short, natural, conversational response (1-2 sentences) acknowledging what you changed — like a real person would say.',
      '"itinerary" is the complete updated itinerary with the same JSON shape as the input. Only modify what the user asked to change.',
      'If the input itinerary is country-scope, preserve tripOverview.tripScope="COUNTRY", destinations[], tripLegs[], routeGeoJson, flightSuggestionsByLeg[], and hotelSuggestionsByDestination[].',
      'Never collapse a country itinerary into a single-city format.',
      'For flightSuggestionsByLeg options, always provide a usable deepLinkUrl (booking/search URL).',
      'CURRENCY RULE: Preserve the currencyCode and currencySymbol from the input itinerary. All budget figures must stay in the same currency as the original.',
      'Output valid JSON only — no markdown fences, no prose outside the JSON.',
      'NEVER say "I hit a snag", "I apologize", "I\'m sorry", "as an AI", or any robotic phrase in the reply.',
      'Example reply: "Done! Swapped Day 3 to focus on cenotes and jungle hikes — should be a great day."',
      'Example reply: "Got it — moved the beach day to Day 5 and added a snorkeling session in the afternoon."',
    ].join(' ');

    const userPrompt = `Current itinerary:
${JSON.stringify(payload.itinerary, null, 2)}

${historyLines ? `Conversation so far:\n${historyLines}\n\n` : ''}User request: ${payload.message}

Return JSON with this exact shape:
{
  "reply": "short natural confirmation of what changed",
  "itinerary": { ...complete updated itinerary... }
}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
      const res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          temperature: 0.35,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
        cache: 'no-store',
      });

      const json = (await res.json()) as
        | OpenRouterErrorPayload
        | OpenRouterSuccessPayload;
      if (!res.ok) {
        const msg =
          'error' in json && json.error?.message
            ? json.error.message
            : 'Groq request failed';
        throw new ServiceUnavailableException(`Groq API error: ${msg}`);
      }

      const rawText = extractOpenRouterText(json as OpenRouterSuccessPayload);
      if (!rawText)
        throw new ServiceUnavailableException('No response from Groq');

      const cleaned = stripCodeFence(rawText);
      let result: unknown = cleaned;
      try {
        result = JSON.parse(cleaned);
      } catch {
        /* keep string */
      }

      // Extract reply and itinerary from the structured response
      let reply = 'Done! Your itinerary has been updated.';
      let itinerary: unknown = result;

      if (isObject(result)) {
        if (typeof result.reply === 'string' && result.reply.trim()) {
          reply = result.reply.trim();
        }
        if (result.itinerary !== undefined) {
          itinerary = result.itinerary;
        }
      }

      if (isRoboticReply(reply)) {
        reply = 'Done. I updated your itinerary based on what you asked.';
      }

      const safeBaseItinerary = isObject(payload.itinerary)
        ? payload.itinerary
        : {};
      let safeRefinedItinerary = isObject(itinerary)
        ? itinerary
        : safeBaseItinerary;

      if (!looksLikeItineraryPayload(safeRefinedItinerary)) {
        safeRefinedItinerary = safeBaseItinerary;
      }

      try {
        safeRefinedItinerary = await this.enforceCountryScopeForRefine(
          safeBaseItinerary,
          safeRefinedItinerary,
        );
      } catch {
        // Keep refine resilient even if enrichment providers fail.
        safeRefinedItinerary = safeBaseItinerary;
      }

      if (!looksLikeItineraryPayload(safeRefinedItinerary)) {
        safeRefinedItinerary = safeBaseItinerary;
      }

      return { reply, itinerary: safeRefinedItinerary };
    } catch (error) {
      if (
        error instanceof ServiceUnavailableException ||
        error instanceof GatewayTimeoutException
      )
        throw error;
      if (error instanceof Error && error.name === 'AbortError')
        throw new GatewayTimeoutException('Refine request timed out');
      throw new ServiceUnavailableException('Failed to refine itinerary');
    } finally {
      clearTimeout(timeout);
    }
  }

  async confirmTrip(payload: ConfirmTripDto) {
    const startDate = payload.exactStartDate.trim();
    const endDate = payload.exactEndDate.trim();

    if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
      throw new BadRequestException(
        'exactStartDate and exactEndDate must use YYYY-MM-DD format',
      );
    }

    if (new Date(startDate) > new Date(endDate)) {
      throw new BadRequestException(
        'exactStartDate must be before or equal to exactEndDate',
      );
    }

    const context = payload.tripContext;
    const followUpAnswers = (payload.followUpAnswers ?? [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, MAX_FOLLOW_UP_ANSWERS);

    const destination =
      getPathString(context, ['destination', 'resolved_region']) ||
      getPathString(context, ['destination', 'raw_input']) ||
      'Selected destination';

    const budgetTier =
      getPathString(context, ['budget', 'tier']) || 'thoughtful';
    const companionsType =
      getPathString(context, ['companions', 'type']) || 'solo';
    const interests = getPathStringArray(context, ['interests']);
    const exclusions = getPathStringArray(context, ['exclusions']);
    const accommodationStyle =
      getPathString(context, ['accommodation', 'style']) || 'city boutique';
    const activityLevel =
      getPathNumber(context, ['pace', 'activity_level']) ?? 0.5;
    const spontaneity = getPathNumber(context, ['pace', 'spontaneity']) ?? 0.5;
    const tripDays = getInclusiveTripDays(startDate, endDate);
    const contextCountryCode =
      getPathString(context, ['countryCode']) ||
      getPathString(context, ['destination', 'country_code']) ||
      null;
    const requestedTripScope =
      getPathString(context, ['tripScope']).toUpperCase() === 'COUNTRY'
        ? 'COUNTRY'
        : 'CITY';
    const countryRoutePlan = await this.detectCountryRoutePlan(
      destination,
      startDate,
      tripDays,
      contextCountryCode,
    );
    const tripScope =
      countryRoutePlan || requestedTripScope === 'COUNTRY' ? 'COUNTRY' : 'CITY';

    const originCity =
      getPathString(context, ['originCity']) ||
      getPathString(context, ['origin_city']) ||
      '';
    const flightBudgetAmount =
      getPathNumber(context, ['flightBudget', 'amount']) ?? undefined;
    const accommodationBudgetAmount =
      getPathNumber(context, ['accommodationBudget', 'amount']) ?? undefined;

    const contextualAnswersObject = getPathObject(context, [
      'contextual_answers',
    ]);
    const contextualAnswers = contextualAnswersObject
      ? Object.entries(contextualAnswersObject)
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join('; ')
      : 'none yet';

    const seasonalPreference =
      getPathString(context, ['travel_dates', 'season']) || 'flexible';

    const apiKey = process.env.GROQ_API_KEY?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Missing GROQ_API_KEY server configuration',
      );
    }

    const model = GROQ_MODEL;

    const systemPrompt = [
      'You are a senior travel advisor creating highly personalized itineraries from a conversational profile.',
      'Output valid JSON only. No markdown fences, no additional prose.',
      "Prioritize realistic timing, budget awareness, and the user's stated exclusions.",
      'CURRENCY RULE: All budget figures MUST be in the official local currency of the destination country.',
      'Examples: Japan ? JPY, USA ? USD, UK ? GBP, Mexico ? MXN, Thailand ? THB, Australia ? AUD, Brazil ? BRL.',
      'Always include currencyCode (ISO 4217, e.g. "JPY") and currencySymbol (e.g. "¥") in tripOverview.',
      'If the user mentioned a budget in their own currency (e.g. "$2000"), convert it to the destination currency and use that as the budget ceiling.',
    ].join(' ');

    const userPrompt = `Build a full itinerary from this conversational profile:
- Destination focus: ${destination}
- Trip scope: ${tripScope}
- Country code hint: ${countryRoutePlan?.countryCode ?? 'n/a'}
- Exact dates: ${startDate} to ${endDate}
- Trip length: ${tripDays} day(s)
- Companions: ${companionsType}
- Budget tier: ${budgetTier}
- Seasonal preference: ${seasonalPreference}
- Activity level (0-1): ${activityLevel}
- Spontaneity (0-1): ${spontaneity}
- Top interests: ${interests.join(', ') || 'none specified'}
- Exclusions: ${exclusions.join(', ') || 'none specified'}
- Accommodation style: ${accommodationStyle}
- Contextual answers: ${contextualAnswers}
- Additional follow-up answers: ${followUpAnswers.join('; ') || 'none'}
${countryRoutePlan ? `- Country route seed: ${countryRoutePlan.destinations.map((stop) => `${stop.stopOrder}. ${stop.cityName}`).join(' -> ')}` : '- Country route seed: n/a'}

Requirements:
1) Return day-by-day morning/afternoon/evening plans.
2) Respect exclusions (avoid crowded/trap-like suggestions if requested).
3) Keep logistics realistic and budget-conscious.
4) All budget numbers must be in the destination's local currency.
5) Add reservation alerts and transport notes.
6) Include 3-5 updated follow-up questions.
7) If trip scope is COUNTRY, spread activities across the seeded city sequence above.

Return this exact JSON shape:
{
  "tripOverview": {
    "destination": "string",
    "travelWindow": "string",
    "planningStyle": "string",
    "currencyCode": "ISO 4217 code e.g. JPY",
    "currencySymbol": "e.g. ¥",
    "keyAssumptions": ["string"]
  },
  "dailyItinerary": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "focus": "string",
      "morning": ["string"],
      "afternoon": ["string"],
      "evening": ["string"],
      "estimatedBudget": { "low": 0, "high": 0 },
      "budgetTips": ["string"],
      "logisticsNotes": ["string"],
      "reservationAlerts": ["string"]
    }
  ],
  "overallBudgetEstimate": {
    "low": 0,
    "high": 0,
    "notes": ["string"]
  },
  "followUpQuestions": [
    {
      "question": "string",
      "whyItMatters": "string"
    }
  ],
  "destinations": [
    {
      "stopOrder": 1,
      "cityName": "string",
      "countryCode": "string",
      "latitude": 0,
      "longitude": 0,
      "startDate": "YYYY-MM-DD",
      "endDate": "YYYY-MM-DD",
      "nights": 0
    }
  ]
}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
      const openRouterRes = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.35,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
        cache: 'no-store',
      });

      const openRouterJson = (await openRouterRes.json()) as
        | OpenRouterErrorPayload
        | OpenRouterSuccessPayload;

      if (!openRouterRes.ok) {
        const errorMessage =
          'error' in openRouterJson && openRouterJson.error?.message
            ? openRouterJson.error.message
            : 'Groq request failed';

        if (openRouterRes.status === 408 || openRouterRes.status === 504) {
          throw new GatewayTimeoutException(
            `OpenRouter API timeout: ${errorMessage}`,
          );
        }

        throw new ServiceUnavailableException(
          `OpenRouter API error: ${errorMessage}`,
        );
      }

      const rawText = extractOpenRouterText(
        openRouterJson as OpenRouterSuccessPayload,
      );

      if (!rawText) {
        throw new ServiceUnavailableException(
          'OpenRouter did not return a valid itinerary response',
        );
      }

      const cleaned = stripCodeFence(rawText);
      let result: unknown = cleaned;

      try {
        result = JSON.parse(cleaned);
      } catch {
        // Keep raw text if JSON parsing fails.
      }

      let finalResult: unknown = result;

      if (isObject(result)) {
        const tripOverview = isObject(result.tripOverview)
          ? { ...result.tripOverview }
          : {};

        const currencyCode =
          typeof tripOverview.currencyCode === 'string' &&
          tripOverview.currencyCode.trim().length > 0
            ? tripOverview.currencyCode.trim().toUpperCase()
            : getPathString(context, ['flightBudget', 'currency']) || 'USD';

        if (countryRoutePlan) {
          const suggestions = await this.buildMultiDestinationSuggestions(
            countryRoutePlan,
            currencyCode,
            originCity,
            flightBudgetAmount,
            accommodationBudgetAmount,
          );

          finalResult = {
            ...result,
            tripOverview: {
              ...tripOverview,
              tripScope: 'COUNTRY',
              countryCode: countryRoutePlan.countryCode,
            },
            destinations: countryRoutePlan.destinations,
            tripLegs: countryRoutePlan.tripLegs,
            routeGeoJson: countryRoutePlan.routeGeoJson,
            flightSuggestionsByLeg: suggestions.flightSuggestionsByLeg,
            hotelSuggestionsByDestination:
              suggestions.hotelSuggestionsByDestination,
          };
        } else {
          const modelDestinations = Array.isArray(result.destinations)
            ? result.destinations
            : [];
          const inferredScopeFromModel =
            modelDestinations.length > 1 || requestedTripScope === 'COUNTRY'
              ? 'COUNTRY'
              : 'CITY';
          const inferredCountryCodeFromModel =
            typeof tripOverview.countryCode === 'string' &&
            tripOverview.countryCode.trim().length > 0
              ? tripOverview.countryCode.trim().toUpperCase()
              : contextCountryCode
                ? contextCountryCode.toUpperCase()
                : null;

          finalResult = {
            ...result,
            tripOverview: {
              ...tripOverview,
              tripScope: inferredScopeFromModel,
              countryCode: inferredCountryCodeFromModel,
            },
          };
        }
      }

      return {
        result: finalResult,
        provider: 'openrouter',
        model,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof GatewayTimeoutException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException('Trip generation request timed out');
      }

      throw new ServiceUnavailableException(
        'Failed to generate trip itinerary',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
