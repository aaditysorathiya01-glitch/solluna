-- CreateTable
CREATE TABLE "LabelCropJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "includeInvoices" BOOLEAN NOT NULL DEFAULT false,
    "fileName" TEXT NOT NULL,
    "sourceKey" TEXT,
    "outputKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "marketplace" TEXT,
    "labelCount" INTEGER NOT NULL DEFAULT 0,
    "invoiceCount" INTEGER NOT NULL DEFAULT 0,
    "unrecognisedPages" INTEGER[],
    "reviewPages" INTEGER[],
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LabelCropJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabelCropJob_organizationId_createdAt_idx" ON "LabelCropJob"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "LabelCropJob_status_idx" ON "LabelCropJob"("status");


-- Plan defaults for the new Label Cropping Tool (packages/permissions FEATURES.LABEL_CROPPER); existing rows are kept.
INSERT INTO "PlanFeature" ("id", "planId", "featureKey", "enabled", "limitValue", "meta")
SELECT 'lc_' || md5(p."id" || 'LABEL_CROPPER'), p."id", 'LABEL_CROPPER', true, NULL,
  CASE p."code" WHEN 'RESELLER' THEN '{"mode":"MANUAL"}'::jsonb WHEN 'GROWTH' THEN '{"mode":"AUTO_MANUAL"}'::jsonb ELSE '{"mode":"AUTO_SPECIAL_MANUAL"}'::jsonb END
FROM "Plan" p
WHERE p."code" IN ('RESELLER', 'GROWTH', 'PREMIUM')
ON CONFLICT ("planId", "featureKey") DO NOTHING;
