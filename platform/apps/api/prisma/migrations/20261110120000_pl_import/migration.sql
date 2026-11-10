CREATE TABLE "PlImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'FLIPKART',
    "documentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "data" JSONB,
    "error" TEXT,
    "startedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlImport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PlImport_organizationId_periodMonth_idx" ON "PlImport"("organizationId", "periodMonth");
CREATE INDEX "PlImport_status_idx" ON "PlImport"("status");
