CREATE TABLE "ReportFetch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'FLIPKART',
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUEST',
    "files" JSONB NOT NULL,
    "checks" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "ordersPlId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReportFetch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportFetch_organizationId_marketplace_period_key" ON "ReportFetch"("organizationId", "marketplace", "period");
CREATE INDEX "ReportFetch_status_nextAt_idx" ON "ReportFetch"("status", "nextAt");
