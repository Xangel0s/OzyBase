-- OzyBase Auto-Generated Migration
-- Description: create_collection_schema_child_77017131

CREATE TABLE IF NOT EXISTS "schema_child_77017131" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" UUID REFERENCES "schema_parent_77017131"("id") ON DELETE CASCADE,
	"summary" TEXT
)