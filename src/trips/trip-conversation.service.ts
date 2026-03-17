import {
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfirmTripDto } from './dto/confirm-trip.dto';
import { ConversationDto } from './dto/conversation.dto';

type TripTheme = 'nature' | 'historic';
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
const OPENROUTER_TIMEOUT_MS = 120_000;
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

function normalizeConversationResponse(
  payload: unknown,
  fallbackStep: ConversationStep,
): {
  agentReply: string;
  nextStep: ConversationStep;
  tripContextUpdates: Record<string, unknown>;
} {
  if (!isObject(payload)) {
    return {
      agentReply: 'Could you say that again?',
      nextStep: fallbackStep,
      tripContextUpdates: {},
    };
  }

  const agentReply =
    typeof payload.agentReply === 'string' && payload.agentReply.trim().length > 0
      ? payload.agentReply.trim()
      : 'Could you say that again?';
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

function normalizeTheme(interests: string[]): TripTheme {
  const joined = interests.join(' ').toLowerCase();

  if (
    joined.includes('ruins') ||
    joined.includes('temple') ||
    joined.includes('art') ||
    joined.includes('museum')
  ) {
    return 'historic';
  }

  return 'nature';
}

@Injectable()
export class TripConversationService {
  parseIntent(rawInput: string) {
    const input = rawInput.trim();
    const lowered = input.toLowerCase();

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
      extracted: {
        vibe_keywords: vibeKeywords,
        intensity,
      },
    };
  }

  generateContextualQuestions(tripContext: Record<string, unknown>) {
    const interests = getPathStringArray(tripContext, ['interests']);
    const exclusions = getPathStringArray(tripContext, ['exclusions']);
    const companionsType = getPathString(tripContext, [
      'companions',
      'type',
    ]).toLowerCase();

    const questions: ContextualQuestion[] = [];

    if (interests.some((entry) => entry.toLowerCase().includes('temple'))) {
      questions.push({
        id: 'temple_guided_or_solo',
        question:
          'Do you want your temple-complex day with a guide, or would you rather explore on your own?',
        answerType: 'a_b',
        options: ['Guided', 'Solo'],
        whyItMatters:
          'Changes pacing, route complexity, and depth of historical context.',
      });
    }

    if (interests.some((entry) => entry.toLowerCase().includes('trek'))) {
      questions.push({
        id: 'trek_guided_level',
        question:
          'Would you prefer an easy independent trek or a guided moderate route?',
        answerType: 'a_b',
        options: ['Easy independent', 'Guided moderate'],
        whyItMatters: 'Aligns activity difficulty with safety and comfort.',
      });
    }

    if (
      interests.some((entry) => entry.toLowerCase().includes('street food'))
    ) {
      questions.push({
        id: 'food_spice_tolerance',
        question:
          'Any dietary restrictions or spice limits I should design around?',
        answerType: 'free_text',
        whyItMatters:
          'Prevents bad food matches and improves dining confidence.',
      });
    }

    if (exclusions.some((entry) => entry.toLowerCase().includes('crowd'))) {
      questions.push({
        id: 'crowd_avoidance_time',
        question:
          'Are you comfortable starting early to avoid crowds at priority stops?',
        answerType: 'yes_no',
        options: ['Yes', 'No'],
        whyItMatters: 'Determines timing strategy for high-demand landmarks.',
      });
    }

    if (companionsType.includes('family')) {
      questions.push({
        id: 'family_rest_balance',
        question:
          'Would you like one low-stimulation rest block each day for kids?',
        answerType: 'yes_no',
        options: ['Yes', 'No'],
        whyItMatters: 'Prevents over-packed days for family travelers.',
      });
    }

    const fallback: ContextualQuestion[] = [
      {
        id: 'free_day_mid_trip',
        question:
          'Do you want one full unplanned day in the middle of the trip?',
        answerType: 'yes_no',
        options: ['Yes', 'No'],
        whyItMatters: 'Adds flexibility and prevents schedule fatigue.',
      },
      {
        id: 'transport_preference',
        question:
          'Do you prefer minimal transfers even if total travel time is longer?',
        answerType: 'yes_no',
        options: ['Yes', 'No'],
        whyItMatters: 'Changes routing strategy and daily movement planning.',
      },
    ];

    const merged = [...questions, ...fallback].slice(0, 3);

    return { questions: merged };
  }

  async continueConversation(payload: ConversationDto) {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Missing OPENROUTER_API_KEY server configuration',
      );
    }

    const step = isConversationStep(payload.currentStep)
      ? payload.currentStep
      : 'destination';

    const systemPrompt = [
      'You are a warm, natural-sounding travel advisor speaking in short, conversational turns.',
      'Guide a structured trip intake through the steps: destination, duration, companions, budget, season, pace, interests, exclusions, accommodation, contextual, confirm.',
      'You MUST output valid JSON only, with no markdown.',
      'Always return: agentReply (string), nextStep (one of the steps), tripContextUpdates (object).',
      'Update only fields you are confident about based on the user utterance and existing context.',
      'If the user already provided multiple details, you may advance multiple steps, but keep it natural.',
      'If the user only makes small talk, respond briefly and steer toward trip planning.',
      'If the destination is missing, ask where they want to go.',
      'When you reach confirm step, ask for exact start/end dates in YYYY-MM-DD and set travel_dates.exact_start/exact_end when given.',
      'Use allowed enum values:',
      'companions.type: solo | couple | friends_small | friends_group | family_with_kids | work_trip',
      'budget.tier: shoestring | thoughtful | comfortable | premium | no_limit',
      'travel_dates.season: spring | summer | autumn | winter | shoulder, plus optional moods as a comma-separated string',
      'interests/exclusions: use the most relevant from the provided lists if mentioned.',
    ].join(' ');

    const userPrompt = `Current step: ${step}
User said: """${payload.lastUserUtterance}"""
Existing trip context JSON:
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
    "destination": { "raw_input": "...", "resolved_region": "...", "confidence": 0.7 },
    "duration": { "min": 7, "max": 10 },
    "companions": { "type": "couple", "count": 2, "children": false },
    "budget": { "tier": "comfortable" },
    "travel_dates": { "season": "summer, low-crowds", "exact_start": "YYYY-MM-DD", "exact_end": "YYYY-MM-DD" },
    "pace": { "activity_level": 0.5, "spontaneity": 0.5 },
    "interests": ["..."],
    "exclusions": ["..."],
    "accommodation": { "style": "City Boutique", "tier": "comfortable" },
    "contextual_answers": { "question_id": "answer" },
    "confirmed": false
  }
}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
      const openRouterRes = await fetch(OPENROUTER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer':
            process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000',
          'X-Title': process.env.OPENROUTER_APP_NAME ?? 'BucketTrips Backend',
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL,
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

      return normalizeConversationResponse(parsed, step);
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

    const apiKey = process.env.OPENROUTER_API_KEY?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Missing OPENROUTER_API_KEY server configuration',
      );
    }

    const model = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
    const theme = normalizeTheme(interests);

    const systemPrompt = [
      'You are a senior travel advisor creating highly personalized itineraries from a conversational profile.',
      'Output valid JSON only. No markdown fences, no additional prose.',
      "Prioritize realistic timing, budget awareness, and the user's stated exclusions.",
    ].join(' ');

    const userPrompt = `Build a full itinerary from this conversational profile:
- Destination focus: ${destination}
- Exact dates: ${startDate} to ${endDate}
- Trip length: ${tripDays} day(s)
- Theme mapping: ${theme}
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

Requirements:
1) Return day-by-day morning/afternoon/evening plans.
2) Respect exclusions (avoid crowded/trap-like suggestions if requested).
3) Keep logistics realistic and budget-conscious.
4) Add reservation alerts and transport notes.
5) Include 3-5 updated follow-up questions.

Return this exact JSON shape:
{
  "tripOverview": {
    "destination": "string",
    "travelWindow": "string",
    "theme": "nature | historic",
    "planningStyle": "string",
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
      "estimatedBudgetEur": { "low": 0, "high": 0 },
      "budgetTips": ["string"],
      "logisticsNotes": ["string"],
      "reservationAlerts": ["string"]
    }
  ],
  "overallBudgetEstimateEur": {
    "low": 0,
    "high": 0,
    "notes": ["string"]
  },
  "followUpQuestions": [
    {
      "question": "string",
      "whyItMatters": "string"
    }
  ]
}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

    try {
      const openRouterRes = await fetch(OPENROUTER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer':
            process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000',
          'X-Title': process.env.OPENROUTER_APP_NAME ?? 'BucketTrips Backend',
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

      return {
        result,
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

