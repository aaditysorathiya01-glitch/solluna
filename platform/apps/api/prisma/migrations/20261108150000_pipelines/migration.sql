CREATE TABLE "PipelineRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pipeline" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL DEFAULT '{}',
    "secrets" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PipelineRun_organizationId_status_idx" ON "PipelineRun"("organizationId", "status");
CREATE TABLE "PipelineOtp" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "cipher" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PipelineOtp_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PipelineOtp_runId_idx" ON "PipelineOtp"("runId");
CREATE INDEX "PipelineOtp_expiresAt_idx" ON "PipelineOtp"("expiresAt");
