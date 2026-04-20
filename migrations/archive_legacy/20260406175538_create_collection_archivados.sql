-- OzyBase Auto-Generated Migration
-- Description: create_collection_archivados

CREATE TABLE IF NOT EXISTS "archivados" (
	"id_archivados" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"nombre" VARCHAR,
	"fecha" DATE,
	"tama_o" NUMERIC
)