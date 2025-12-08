-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyProductHandle" TEXT,
    "shopifyProductTitle" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "imageUrl" TEXT,
    "pdfUrl" TEXT,
    "accessUrl" TEXT NOT NULL,
    "categoryLabel" TEXT,
    "levelLabel" TEXT,
    "estimatedHours" DOUBLE PRECISION,
    "trainerEmail" TEXT,
    "trainerShopifyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentCourse" (
    "id" TEXT NOT NULL,
    "studentEmail" TEXT NOT NULL,
    "shopifyCustomerId" TEXT,
    "courseId" TEXT NOT NULL,
    "shopifyOrderId" TEXT,
    "shopifyLineItemId" TEXT,
    "purchaseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessAt" TIMESTAMP(3),
    "status" "CourseStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StudentCourse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Course_shopifyProductId_key" ON "Course"("shopifyProductId");

-- CreateIndex
CREATE INDEX "Course_shopifyProductId_idx" ON "Course"("shopifyProductId");

-- CreateIndex
CREATE INDEX "Course_accessUrl_idx" ON "Course"("accessUrl");

-- CreateIndex
CREATE INDEX "Course_trainerEmail_idx" ON "Course"("trainerEmail");

-- CreateIndex
CREATE INDEX "StudentCourse_studentEmail_idx" ON "StudentCourse"("studentEmail");

-- CreateIndex
CREATE INDEX "StudentCourse_shopifyCustomerId_idx" ON "StudentCourse"("shopifyCustomerId");

-- CreateIndex
CREATE INDEX "StudentCourse_shopifyOrderId_idx" ON "StudentCourse"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "StudentCourse_courseId_idx" ON "StudentCourse"("courseId");

-- AddForeignKey
ALTER TABLE "StudentCourse" ADD CONSTRAINT "StudentCourse_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
