## 1. Implementation
- [x] 1.1 Add DTOs: `ConversationDto` (with `conversationHistory`), `ConfirmTripDto`
- [x] 1.2 Add `POST /api/trips/parse-intent` endpoint
- [x] 1.3 Add `POST /api/trips/contextual-questions` endpoint
- [x] 1.4 Add `POST /api/trips/conversation` endpoint — natural language turn handler backed by OpenRouter
- [x] 1.5 Add `POST /api/trips/confirm` endpoint — generates full itinerary from `TripContext` via OpenRouter
- [x] 1.6 Add `TripContext` mapping logic from conversational inputs to itinerary prompt
- [x] 1.7 Return structured itinerary payload compatible with existing frontend renderer

## 2. Conversation Intelligence
- [x] 2.1 Inject full `conversationHistory` into LLM user prompt each turn
- [x] 2.2 Rewrite system prompt with small talk examples, context extraction rules, and JSON-only output enforcement
- [x] 2.3 Add `ROBOTIC_PHRASES` blocklist with `naturalFallback()` — greeting-aware safe reply when model misbehaves
- [x] 2.4 Set `OPENROUTER_MODEL` via env var; default to `meta-llama/llama-3.1-8b-instruct:free`
- [x] 2.5 Reduce `OPENROUTER_TIMEOUT_MS` to 20s for conversational turns

## 3. Validation
- [x] 3.1 `npm run lint` — no errors
- [x] 3.2 `npm run build` — clean build
- [x] 3.3 Manual API checks: `/conversation` and `/confirm` endpoints verified end-to-end
