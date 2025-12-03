-- CreateEnum
CREATE TYPE "PayoutType" AS ENUM ('sale', 'withdraw', 'paid');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('available', 'requested', 'paid', 'reversed');

-- CreateTable
CREATE TABLE "TrainerBanking" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "email" TEXT,
    "payoutName" TEXT,
    "payoutCountry" TEXT,
    "payoutIban" TEXT,
    "payoutBic" TEXT,
    "autoPayout" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerBanking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutsSummary" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "availableAmount" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "pendingAmount" DECIMAL(65,30) NOT NULL DEFAULT 0.0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutsSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutsHistory" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "type" "PayoutType" NOT NULL,
    "status" "PayoutStatus" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "PayoutsHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainerBanking_trainerId_key" ON "TrainerBanking"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutsSummary_trainerId_key" ON "PayoutsSummary"("trainerId");

-- CreateIndex
CREATE INDEX "PayoutsHistory_trainerId_date_idx" ON "PayoutsHistory"("trainerId", "date");

-- AddForeignKey
ALTER TABLE "PayoutsSummary" ADD CONSTRAINT "PayoutsSummary_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerBanking"("trainerId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutsHistory" ADD CONSTRAINT "PayoutsHistory_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "TrainerBanking"("trainerId") ON DELETE RESTRICT ON UPDATE CASCADE;
