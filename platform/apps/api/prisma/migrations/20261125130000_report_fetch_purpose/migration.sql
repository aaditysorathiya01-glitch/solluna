ALTER TABLE "ReportFetch" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'PL';
DROP INDEX "ReportFetch_organizationId_marketplace_period_key";
CREATE UNIQUE INDEX "ReportFetch_organizationId_marketplace_purpose_period_key" ON "ReportFetch"("organizationId", "marketplace", "purpose", "period");
