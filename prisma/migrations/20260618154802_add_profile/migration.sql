-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "givenName" TEXT,
    "familyName" TEXT,
    "middleName" TEXT,
    "nickname" TEXT,
    "birthdate" TIMESTAMP(3),
    "gender" TEXT,
    "pronouns" TEXT,
    "locale" TEXT,
    "zoneinfo" TEXT,
    "picture" TEXT,
    "website" TEXT,
    "profileUrl" TEXT,
    "phoneNumber" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "streetAddress" TEXT,
    "locality" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profile_memberId_key" ON "Profile"("memberId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
