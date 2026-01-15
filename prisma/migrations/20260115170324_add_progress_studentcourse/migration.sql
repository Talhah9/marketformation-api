-- AlterTable
ALTER TABLE "StudentCourse" ADD COLUMN     "progressData" JSONB,
ADD COLUMN     "progressPct" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "StudentCourse_studentEmail_courseId_idx" ON "StudentCourse"("studentEmail", "courseId");
