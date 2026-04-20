-- OzyBase Auto-Generated Migration
-- Description: create_collection_api

CREATE TABLE IF NOT EXISTS "api" (
	"id" UUID DEFAULT gen_random_uuid(),
	"apirest" TEXT
)