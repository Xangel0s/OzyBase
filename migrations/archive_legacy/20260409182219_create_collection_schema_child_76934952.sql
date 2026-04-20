-- OzyBase Auto-Generated Migration
-- Description: create_collection_schema_child_76934952

CREATE TABLE IF NOT EXISTS "schema_child_76934952" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" UUID REFERENCES "schema_parent_76934952"("id") ON DELETE CASCADE,
	"summary" TEXT
)