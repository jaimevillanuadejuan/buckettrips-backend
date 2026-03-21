import {
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
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

// Phrases that indicate the model returned a robotic/error-like response
// despite being told not to. We replace these with a natural fallback.
const ROBOTIC_PHRASES = [
  'i hit a snag',
  'i encountered',
  'i apologize',
  'i\'m sorry, but',
  'i am sorry',
  'i\'m unable',
  'i cannot',
  'as an ai',
  'i\'m afraid',
  'unfortunately',
  'i\'m having trouble',
  'something went wrong',
  'could you say that again',
];

const SMALL_TALK_FALLBACKS = [
  "Hey! So where are we headed — got a destination in mind?",
  "Doing well, thanks! So, where are we thinking for this trip?",
  "Good! Ready when you are — where do you want to go?",
];

function isRoboticReply(text: string): boolean {
  const lower = text.toLowerCase();
  return ROBOTIC_PHRASES.some((phrase) => lower.includes(phrase));
}

function naturalFallback(utterance: string): string {
  const lower = utterance.toLowerCase().trim();
  const isGreeting =
    /^(hey|hi|hello|what'?s up|how'?s it going|how are you|good morning|good evening|yo)\b/.test(lower);
  if (isGreeting) {
    return SMALL_TALK_FALLBACKS[Math.floor(Math.random() * SMALL_TALK_FALLBACKS.length)];
  }
  return "Sorry, I missed that — could you say it again?";
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
    typeof payload.agentReply === 'string' && payload.agentReply.trim().length > 0
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

  async generateContextualQuestions(
    tripContext: Record<string, unknown>,
    conversationHistory?: Array<{ role: 'user' | 'agent'; text: string }>,
  ) {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('Missing GROQ_API_KEY server configuration');
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

      const json = (await res.json()) as OpenRouterErrorPayload | OpenRouterSuccessPayload;

      if (!res.ok) {
        const msg = 'error' in json && (json as OpenRouterErrorPayload).error?.message
          ? (json as OpenRouterErrorPayload).error!.message
          : 'Groq request failed';
        throw new ServiceUnavailableException(`Groq API error: ${msg}`);
      }

      const rawText = extractOpenRouterText(json as OpenRouterSuccessPayload);
      if (!rawText) throw new ServiceUnavailableException('No response from Groq');

      const cleaned = stripCodeFence(rawText);
      let parsed: unknown;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        return { questions: [] };
      }

      if (
        isObject(parsed) &&
        Array.isArray(parsed.questions)
      ) {
        return { questions: parsed.questions };
      }

      return { questions: [] };
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof GatewayTimeoutException) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new GatewayTimeoutException('Contextual questions request timed out');
      throw new ServiceUnavailableException('Failed to generate contextual questions');
    } finally {
      clearTimeout(timeout);
    }
  }

  async continueConversation(payload: ConversationDto) {
    const apiKey = process.env.GROQ_API_KEY?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException('Missing GROQ_API_KEY server configuration');
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
      '"hey" → agentReply: "Hey! Ready to plan something good — where are we headed?"',
      '"hey how\'s it going" → agentReply: "Pretty good, thanks! So, where are we thinking for this trip?"',
      '"hi there" → agentReply: "Hey! Got a destination in mind, or are we still dreaming?"',
      '"what\'s up" → agentReply: "Not much — just waiting to hear where you want to go. What\'s the plan?"',
      '"how are you" → agentReply: "Doing well! More importantly — where are we going? Got somewhere in mind?"',
      '',
      'CONTEXT EXTRACTION RULE (critical):',
      'Scan the ENTIRE conversation history AND the current utterance for ANY trip details — destination, duration, companions, budget, dates, interests, places, food preferences, activities.',
      'Example: "I want to go to Ibiza with friends for 2 weeks" → extract destination=Ibiza, companions.type=friends_small, duration.min=14, duration.max=14.',
      'Example: "just me and my partner" → companions.type=couple, companions.count=2.',
      'Example: "with a group of friends" → companions.type=friends_small.',
      'If the user provided multiple details, advance nextStep past all resolved fields to the first unresolved one.',
      '',
      'DO NOT ASK ABOUT THINGS ALREADY MENTIONED (critical):',
      'Before generating agentReply, check the full conversation history and tripContext for everything the user has already told you.',
      'If the user mentioned specific places (e.g. "Fontana di Trevi", "Saint Peters"), foods (e.g. "pasta", "gelato"), or activities — treat those as known interests. Do NOT ask about them again.',
      'If dates, duration, companions, or budget are already in tripContext or were mentioned in conversation — skip those steps entirely.',
      'The contextual step is for asking 1 genuinely unclear thing that would meaningfully change the itinerary. If nothing is unclear, skip straight to confirm.',
      '',
      'REQUIRED CHECKLIST — you must collect ALL of these before moving to confirm:',
      '[ ] destination — resolved_region or raw_input is set',
      '[ ] exact_start — a real calendar date in YYYY-MM-DD format',
      '[ ] exact_end — a real calendar date in YYYY-MM-DD format',
      '[ ] companions — type is known (solo / couple / friends_small / friends_group / family_with_kids)',
      '[ ] budget — tier is known (shoestring / thoughtful / comfortable / premium / no_limit)',
      'If ANY item is unchecked, stay on the appropriate step and ask for it. Do NOT advance to confirm.',
      '',
      'DATE CALCULATION RULE:',
      'If the user describes dates in natural language (e.g. "first Saturday of October", "next weekend", "two weeks from now"), calculate the actual YYYY-MM-DD dates yourself and confirm them with the user before setting exact_start/exact_end.',
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

      return normalizeConversationResponse(parsed, step, payload.lastUserUtterance);
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

  async chat(payload: { message: string; history?: Array<{ role: 'user' | 'agent'; text: string }> }) {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('Missing GROQ_API_KEY server configuration');
    }

    const systemPrompt = [
      'You are a warm, knowledgeable travel companion — not a booking bot, not a corporate assistant.',
      'You help people with anything travel-related: trip ideas, destination advice, itinerary consulting, packing, budgeting, visa questions, or just chatting about travel.',
      'If the user greets you or makes small talk, respond like a real person — casual, warm, brief — then naturally bring up travel if it fits.',
      'NEVER say "I hit a snag", "I apologize", "I\'m sorry but", "as an AI", "I\'m unable to", or any robotic phrase.',
      'Small talk examples:',
      '"hey" → "Hey! Got a trip on your mind, or just browsing?"',
      '"how\'s it going" → "Pretty good! You planning something or just dreaming about it?"',
      '"what can you do" → "Pretty much anything travel — where to go, when to go, what to pack, how to budget. What\'s on your mind?"',
      'Keep replies concise — 2 to 4 sentences — unless the user asks for detail.',
      'If the user wants to plan a full trip, guide them naturally: ask about destination, dates, who they\'re going with, and budget — one question at a time.',
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

      const json = (await res.json()) as OpenRouterErrorPayload | OpenRouterSuccessPayload;

      if (!res.ok) {
        const msg = 'error' in json && json.error?.message ? json.error.message : 'OpenRouter request failed';
        throw new ServiceUnavailableException(`OpenRouter API error: ${msg}`);
      }

      let reply = extractOpenRouterText(json as OpenRouterSuccessPayload);

      if (!reply || isRoboticReply(reply)) {
        reply = naturalFallback(payload.message);
      }

      return { reply };
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof GatewayTimeoutException) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new GatewayTimeoutException('Chat request timed out');
      throw new ServiceUnavailableException('Failed to generate chat response');
    } finally {
      clearTimeout(timeout);
    }
  }

  async refineTrip(payload: { itinerary: Record<string, unknown>; message: string; history?: Array<{ role: 'user' | 'agent'; text: string }> }) {
    const apiKey = process.env.GROQ_API_KEY?.trim();
    if (!apiKey) throw new ServiceUnavailableException('Missing GROQ_API_KEY server configuration');

    const historyLines = (payload.history ?? [])
      .map((t) => `${t.role === 'user' ? 'User' : 'Agent'}: ${t.text}`)
      .join('\n');

    const systemPrompt = [
      'You are a warm travel advisor helping refine an existing trip itinerary based on user feedback.',
      'The user will describe a change they want. You MUST return a JSON object with two keys: "reply" and "itinerary".',
      '"reply" is a short, natural, conversational response (1-2 sentences) acknowledging what you changed — like a real person would say.',
      '"itinerary" is the complete updated itinerary with the same JSON shape as the input. Only modify what the user asked to change.',
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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

      const json = (await res.json()) as OpenRouterErrorPayload | OpenRouterSuccessPayload;
      if (!res.ok) {
        const msg = 'error' in json && (json as OpenRouterErrorPayload).error?.message ? (json as OpenRouterErrorPayload).error!.message : 'Groq request failed';
        throw new ServiceUnavailableException(`Groq API error: ${msg}`);
      }

      const rawText = extractOpenRouterText(json as OpenRouterSuccessPayload);
      if (!rawText) throw new ServiceUnavailableException('No response from Groq');

      const cleaned = stripCodeFence(rawText);
      let result: unknown = cleaned;
      try { result = JSON.parse(cleaned); } catch { /* keep string */ }

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

      return { reply, itinerary };
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof GatewayTimeoutException) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new GatewayTimeoutException('Refine request timed out');
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

    const contextualAnswersObject = getPathObject(context, [
      'contextual_answers',
    ]);
    const contextualAnswers = contextualAnswersObject
      ? Object.entries(contextualAnswersObject as Record<string, unknown>)
          .map(([key, value]) => `${key}: ${String(value)}`)
          .join('; ')
      : 'none yet';

    const seasonalPreference =
      getPathString(context, ['travel_dates', 'season']) || 'flexible';

    const apiKey = process.env.GROQ_API_KEY?.trim();

    if (!apiKey) {
      throw new ServiceUnavailableException('Missing GROQ_API_KEY server configuration');
    }

    const model = GROQ_MODEL;

    const systemPrompt = [
      'You are a senior travel advisor creating highly personalized itineraries from a conversational profile.',
      'Output valid JSON only. No markdown fences, no additional prose.',
      "Prioritize realistic timing, budget awareness, and the user's stated exclusions.",
      'CURRENCY RULE: All budget figures MUST be in the official local currency of the destination country.',
      'Examples: Japan → JPY, USA → USD, UK → GBP, Mexico → MXN, Thailand → THB, Australia → AUD, Brazil → BRL.',
      'Always include currencyCode (ISO 4217, e.g. "JPY") and currencySymbol (e.g. "¥") in tripOverview.',
      'If the user mentioned a budget in their own currency (e.g. "$2000"), convert it to the destination currency and use that as the budget ceiling.',
    ].join(' ');

    const userPrompt = `Build a full itinerary from this conversational profile:
- Destination focus: ${destination}
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

Requirements:
1) Return day-by-day morning/afternoon/evening plans.
2) Respect exclusions (avoid crowded/trap-like suggestions if requested).
3) Keep logistics realistic and budget-conscious.
4) All budget numbers must be in the destination's local currency.
5) Add reservation alerts and transport notes.
6) Include 3-5 updated follow-up questions.

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
          'error' in openRouterJson && (openRouterJson as OpenRouterErrorPayload).error?.message
            ? (openRouterJson as OpenRouterErrorPayload).error!.message
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

