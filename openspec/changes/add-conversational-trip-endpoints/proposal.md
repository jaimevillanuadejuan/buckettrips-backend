# Proposal: Conversational Trip API Endpoints

## Why
Conversational trip intake needs backend support for intent parsing, contextual follow-up generation, style filtering, and confirm-time itinerary generation.

## What Changes
- Add `POST /api/trips/parse-intent` for free-text destination parsing.
- Add `POST /api/trips/contextual-questions` for 2-3 AI-guided follow-up prompts.
- Add `GET /api/accommodations/style-filter` for style options tuned by destination and budget tier.
- Add `POST /api/trips/confirm` to generate itinerary payload from `TripContext` and exact dates.
- Keep existing persistence endpoints unchanged (`POST/GET/DELETE /api/trips`).
- Use backend `OPENROUTER_API_KEY` and provider settings for all LLM calls.

## Impact
- Frontend no longer needs direct model orchestration details.
- Conversational profile quality increases itinerary personalization quality.
- API layer cleanly separates conversational generation from persistence.
