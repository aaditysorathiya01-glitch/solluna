CREATE TABLE "LoginCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoginCode_userId_createdAt_idx" ON "LoginCode"("userId", "createdAt");
