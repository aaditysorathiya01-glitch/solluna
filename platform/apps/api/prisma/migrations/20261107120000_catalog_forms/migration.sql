-- CreateTable
CREATE TABLE "CatalogForm" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "requestId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogForm_organizationId_createdAt_idx" ON "CatalogForm"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogTemplate_organizationId_marketplace_kind_name_key" ON "CatalogTemplate"("organizationId", "marketplace", "kind", "name");

