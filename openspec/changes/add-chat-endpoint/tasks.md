## 1. Implementation

- [ ] 1.1 Create `ChatDto` with `message: string` and optional `history` array
- [ ] 1.2 Add `chat()` method to `TripConversationService` — general-purpose travel agent, no step machine
- [ ] 1.3 Add `POST /api/trips/chat` route to `TripsController`
- [ ] 1.4 Write system prompt: warm travel companion persona, small talk handling, no robotic phrases, concise replies

## 2. Validation

- [ ] 2.1 `npm run lint`
- [ ] 2.2 `npm run build`
- [ ] 2.3 Manual test: greeting → natural reply
- [ ] 2.4 Manual test: general travel question → helpful answer
- [ ] 2.5 Manual test: trip planning intent → agent engages and gathers details
- [ ] 2.6 Manual test: conversation history is used for context
