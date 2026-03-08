## 1. Data Layer
- [x] 1.1 Add Prisma Postgres datasource configuration
- [x] 1.2 Add `Trip` model with itinerary JSON payload and metadata fields
- [x] 1.3 Add indexes for `createdAt` (desc) and `location`

## 2. API Endpoints
- [x] 2.1 Implement `POST /api/trips` with validation and persistence
- [x] 2.2 Implement `GET /api/trips` summary list sorted newest-first
- [x] 2.3 Implement `GET /api/trips/:tripId` full record retrieval
- [x] 2.4 Implement `DELETE /api/trips/:tripId` hard-delete behavior

## 3. Validation and Errors
- [x] 3.1 Validate required fields and theme enum (`nature` | `historic`)
- [x] 3.2 Reject invalid itinerary payload shape with `400`
- [x] 3.3 Return `404` for missing trip IDs

## 4. Runtime Compatibility
- [x] 4.1 Keep backend default port at `8080`
- [x] 4.2 Keep CORS origin compatible with local frontend
- [x] 4.3 Keep global API prefix `/api`

## 5. Verification
- [x] 5.1 Run `npm run prisma:generate`
- [x] 5.2 Run `npm run build`
- [ ] 5.3 Validate frontend integration against backend endpoints

## 6. Local Docker Workflow
- [x] 6.1 Add `Dockerfile` for API image build/runtime
- [x] 6.2 Add `docker-compose.yml` for API + Postgres local stack
- [x] 6.3 Document Docker startup/shutdown commands in `README.md`
