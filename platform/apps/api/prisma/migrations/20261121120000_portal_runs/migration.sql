CREATE TABLE "PortalRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "input" JSONB NOT NULL,
    "filled" JSONB,
    "missing" JSONB,
    "shots" JSONB,
    "error" TEXT,
    "listingRef" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortalRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PortalRun_organizationId_createdAt_idx" ON "PortalRun"("organizationId", "createdAt");
CREATE INDEX "PortalRun_status_idx" ON "PortalRun"("status");
