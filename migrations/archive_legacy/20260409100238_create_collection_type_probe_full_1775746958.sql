-- OzyBase Auto-Generated Migration
-- Description: create_collection_type_probe_full_1775746958

CREATE TABLE IF NOT EXISTS "type_probe_full_1775746958" (
	"id" UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
	"c_text" TEXT,
	"c_varchar" VARCHAR,
	"c_uuid" UUID,
	"c_int2" INT2,
	"c_int4" INT4,
	"c_int8" INT8,
	"c_float4" FLOAT4,
	"c_float8" FLOAT8,
	"c_numeric" NUMERIC,
	"c_json" JSON,
	"c_jsonb" JSONB,
	"c_date" DATE,
	"c_time" TIME,
	"c_timetz" TIMETZ,
	"c_timestamp" TIMESTAMP,
	"c_timestamptz" TIMESTAMPTZ,
	"c_bool" BOOL,
	"c_bytea" BYTEA,
	"c_inet" INET,
	"c_cidr" CIDR,
	"c_macaddr" MACADDR,
	"c_interval" INTERVAL,
	"c_money" MONEY,
	"c_text_array" TEXT[],
	"c_int_array" INT4[]
)