-- OzyBase Auto-Generated Migration
-- Description: create_collection_schema_parent_75303803

CREATE TABLE IF NOT EXISTS "schema_parent_75303803" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" TEXT,
	"status" TEXT,
	"score" INT8
)