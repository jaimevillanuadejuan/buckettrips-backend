# BucketTrips Backend

NestJS API for itinerary generation and trip persistence.

## Prerequisites
- Node.js 20+
- PostgreSQL

## Environment
Create `.env`:

```bash
PORT=8080
FRONTEND_URL=http://localhost:3000
DATABASE_URL=postgresql://buckettrips:buckettrips@localhost:5432/buckettrips?schema=public
OPENROUTER_API_KEY=your_key
OPENROUTER_MODEL=openrouter/free
OPENROUTER_SITE_URL=http://localhost:3000
OPENROUTER_APP_NAME=BucketTrips
```

## Setup

```bash
npm install
npm run prisma:generate
npm run prisma:migrate:dev
npm run start:dev
```

API base URL: `http://localhost:8080/api`

## Routes
- `POST /api/api-trips` itinerary generation via OpenRouter
- `POST /api/trips` save itinerary
- `GET /api/trips` list saved trips
- `GET /api/trips/:tripId` get trip detail
- `DELETE /api/trips/:tripId` delete trip

## Docker

```bash
docker compose up --build
```
