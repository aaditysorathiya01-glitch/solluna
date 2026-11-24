CREATE TABLE "OrdersPl" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL DEFAULT 'FLIPKART',
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "documentIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "lines" JSONB,
    "meta" JSONB,
    "error" TEXT,
    "startedById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrdersPl_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrdersPl_organizationId_periodMonth_idx" ON "OrdersPl"("organizationId", "periodMonth");
CREATE INDEX "OrdersPl_status_idx" ON "OrdersPl"("status");
CREATE TABLE "SkuItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "packQty" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SkuItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SkuItem_organizationId_sku_key" ON "SkuItem"("organizationId", "sku");
