-- OzyBase Auto-Generated Migration
-- Description: duplicate_collection_api_to_api_copy

CREATE TABLE "api_copy" (LIKE "api" INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
INSERT INTO "api_copy" SELECT * FROM "api"