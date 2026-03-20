# Chat Endpoint Spec

## Requirement: General-Purpose Travel Agent Chat
The system SHALL expose a `POST /api/trips/chat` endpoint that acts as a free-form travel agent consultant.

### Behavior
- Accepts a user message and optional conversation history
- Returns a natural, conversational reply — no structured JSON schema enforced on the LLM output
- Handles any travel-related topic: trip ideas, destination advice, packing, budgeting, itinerary consulting, small talk
- Handles greetings and small talk naturally, steering toward travel when appropriate
- Never returns robotic error phrases

### Scenario: Small talk
- **WHEN** the user sends "hey how's it going"
- **THEN** the agent replies warmly and naturally, e.g. "Hey! Doing well — got a trip on your mind?"

### Scenario: General travel question
- **WHEN** the user asks "what's the best time to visit Japan?"
- **THEN** the agent gives a helpful, conversational answer without requiring any structured context

### Scenario: Trip planning intent
- **WHEN** the user says "I want to plan a trip to Lisbon with my partner"
- **THEN** the agent engages naturally and starts gathering details conversationally

### Scenario: Conversation history
- **WHEN** prior turns are included in `history`
- **THEN** the agent uses them for context in its reply

---

## DTO: ChatDto
```ts
{
  message: string;           // required — the user's latest message
  history?: Array<{          // optional — prior turns
    role: 'user' | 'agent';
    text: string;
  }>;
}
```

## Response shape
```ts
{
  reply: string;   // the agent's natural language response
}
```

---

## System Prompt Behavior
- Persona: warm, knowledgeable travel companion — not a booking bot
- Handles small talk naturally, pivots to travel when relevant
- Never says "I hit a snag", "I apologize", "as an AI", or similar robotic phrases
- Keeps replies concise (2-4 sentences) unless the user asks for detail
- If the user wants to plan a full trip, guides them naturally toward destination, dates, companions, budget
