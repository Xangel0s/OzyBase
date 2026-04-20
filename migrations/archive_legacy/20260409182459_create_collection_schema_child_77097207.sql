-- OzyBase Auto-Generated Migration
-- Description: create_collection_schema_child_77097207

CREATE TABLE IF NOT EXISTS "schema_child_77097207" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" UUID REFERENCES "schema_parent_77097207"("id") ON DELETE CASCADE,
	"summary" TEXT
)