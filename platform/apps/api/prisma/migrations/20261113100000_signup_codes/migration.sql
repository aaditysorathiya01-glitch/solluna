CREATE TABLE "SignupCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignupCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SignupCode_email_createdAt_idx" ON "SignupCode"("email", "createdAt");
