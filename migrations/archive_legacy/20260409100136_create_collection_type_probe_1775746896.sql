-- OzyBase Auto-Generated Migration
-- Description: create_collection_type_probe_1775746896

CREATE TABLE IF NOT EXISTS "type_probe_1775746896" (
	"id" UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
	"c_text" TEXT,
	"c_varchar" VARCHAR,
	"c_int8" INT8,
	"c_int4" INT4,
	"c_int2" INT2,
	"c_numeric" NUMERIC,
	"c_float8" FLOAT8,
	"c_bool" BOOL,
	"c_timestamptz" TIMESTAMPTZ,
	"c_date" DATE,
	"c_jsonb" JSONB,
	"c_text_array" TEXT[]
)