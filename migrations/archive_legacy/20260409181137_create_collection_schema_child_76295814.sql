-- OzyBase Auto-Generated Migration
-- Description: create_collection_schema_child_76295814

CREATE TABLE IF NOT EXISTS "schema_child_76295814" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" UUID REFERENCES "schema_parent_76295814"("id") ON DELETE CASCADE,
	"summary" TEXT
)