-- CreateTable
CREATE TABLE "ProductLookup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "sources" JSONB,
    "notes" TEXT,
    "error" TEXT,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ProductLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductLookup_organizationId_createdAt_idx" ON "ProductLookup"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductLookup_status_idx" ON "ProductLookup"("status");

-- CreateIndex
CREATE INDEX "ProductLookup_marketplace_ref_idx" ON "ProductLookup"("marketplace", "ref");

