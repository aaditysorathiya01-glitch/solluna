-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "buyer" JSONB,
ADD COLUMN     "cgstPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "financialYear" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "gstRateBps" INTEGER NOT NULL DEFAULT 1800,
ADD COLUMN     "igstPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "intraState" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "placeOfSupply" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sac" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sgstPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supplier" JSONB,
ADD COLUMN     "taxablePaise" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "city" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "stateCode" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "placeOfSupply" TEXT,
ADD COLUMN     "taxPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxablePaise" INTEGER NOT NULL DEFAULT 0;

-- Backfill: invoices issued before GST tax-invoice support (GST-inclusive era) get a LEGACY series
-- so the new (financialYear, sequence) uniqueness holds. Their numbers and amounts are untouched.
UPDATE "Invoice" i SET "financialYear" = 'LEGACY', "sequence" = r.rn, "taxablePaise" = i."amountPaise" - i."gstPaise"
FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY "issuedAt", id) AS rn FROM "Invoice") r WHERE r.id = i.id;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paymentId_key" ON "Invoice"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_financialYear_sequence_key" ON "Invoice"("financialYear", "sequence");

