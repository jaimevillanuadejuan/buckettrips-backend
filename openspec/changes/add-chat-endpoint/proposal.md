# Proposal: General-Purpose Travel Agent Chat Endpoint

## Problem
The existing `POST /api/trips/conversation` endpoint is tightly coupled to the voice trip creation flow — it expects a `currentStep`, a `TripContext` object, and advances a step machine. It is not suitable for free-form chat where the user may want to ask general travel questions, consult about a trip idea, or just have a conversation without committing to a structured intake flow.

## Solution
Add a new `POST /api/trips/chat` endpoint backed by a general-purpose travel agent system prompt. It accepts a free-form message and optional conversation history, and returns a natural reply. No step machine, no TripContext schema, no structured JSON output required from the LLM.

## Scope
- Backend only (`buckettrips-backend` repo)
- New DTO: `ChatDto`
- New method: `TripConversationService.chat()`
- New route: `POST /api/trips/chat`
- No frontend changes in this spec (tracked separately in `buckettrips` repo under `chat-ui-view`)

## Out of scope
- Authentication / user sessions
- Persisting chat history to database
- Streaming responses
