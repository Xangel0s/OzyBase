-- OzyBase Auto-Generated Migration
-- Description: create_collection_prueba01222

CREATE TABLE IF NOT EXISTS "prueba01222" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"int4" INT4,
	"varchar1" VARCHAR,
	"text" TEXT,
	"numero" NUMERIC
)