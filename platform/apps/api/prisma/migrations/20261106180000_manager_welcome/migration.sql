-- CreateTable
CREATE TABLE "ManagerWelcome" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "previousPlanCode" TEXT,
    "kind" TEXT NOT NULL,
    "preview" BOOLEAN NOT NULL DEFAULT false,
    "step" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerWelcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagerWelcome_organizationId_key" ON "ManagerWelcome"("organizationId");

-- CreateIndex
CREATE INDEX "ManagerWelcome_dueAt_idx" ON "ManagerWelcome"("dueAt");

