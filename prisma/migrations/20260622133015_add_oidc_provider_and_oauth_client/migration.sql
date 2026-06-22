-- CreateTable
CREATE TABLE "OidcPayload" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "grantId" TEXT,
    "userCode" TEXT,
    "uid" TEXT,
    "expiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "OidcPayload_pkey" PRIMARY KEY ("type","id")
);

-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretHash" TEXT,
    "redirectUris" TEXT[],
    "allowedScopes" TEXT[],
    "isConfidential" BOOLEAN NOT NULL DEFAULT false,
    "logoUri" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OidcPayload_uid_key" ON "OidcPayload"("uid");

-- CreateIndex
CREATE INDEX "OidcPayload_grantId_idx" ON "OidcPayload"("grantId");

-- CreateIndex
CREATE INDEX "OidcPayload_type_idx" ON "OidcPayload"("type");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClient_clientId_key" ON "OAuthClient"("clientId");
