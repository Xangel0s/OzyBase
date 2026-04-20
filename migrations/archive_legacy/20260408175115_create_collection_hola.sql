-- OzyBase Auto-Generated Migration
-- Description: create_collection_hola

CREATE TABLE IF NOT EXISTS "hola" (
	"id" UUID DEFAULT gen_random_uuid(),
	"como_estas" VARCHAR,
	"que_haces" VARCHAR
)