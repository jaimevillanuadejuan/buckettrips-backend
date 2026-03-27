-- AlterTable
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "preferredCurrency" TEXT;

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN IF NOT EXISTS "accommodationBudget" JSONB;
ALTER TABLE "Trip" ADD COLUMN IF NOT EXISTS "accommodationType" TEXT;
ALTER TABLE "Trip" ADD COLUMN IF NOT EXISTS "flightBudget" JSONB;
ALTER TABLE "Trip" ADD COLUMN IF NOT EXISTS "originCity" TEXT;