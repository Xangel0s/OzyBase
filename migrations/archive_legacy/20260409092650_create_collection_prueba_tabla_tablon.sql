-- OzyBase Auto-Generated Migration
-- Description: create_collection_prueba_tabla_tablon

CREATE TABLE IF NOT EXISTS "prueba_tabla_tablon" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"varchar1" VARCHAR,
	"numeric1" NUMERIC,
	"timelaps" TIMESTAMPTZ
)