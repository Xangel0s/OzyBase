-- OzyBase Auto-Generated Migration
-- Description: create_collection_table

CREATE TABLE IF NOT EXISTS "table" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario_ventas" VARCHAR
)