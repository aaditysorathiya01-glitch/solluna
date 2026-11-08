CREATE TABLE "EvalRun" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "model" TEXT,
    "score" DOUBLE PRECISION,
    "passed" INTEGER,
    "total" INTEGER,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "error" TEXT,
    "startedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "EvalRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EvalRun_createdAt_idx" ON "EvalRun"("createdAt");
