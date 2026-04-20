-- OzyBase Auto-Generated Migration
-- Description: create_collection_schema_child_77655773

CREATE TABLE IF NOT EXISTS "schema_child_77655773" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" UUID REFERENCES "schema_parent_77655773"("id") ON DELETE CASCADE,
	"summary" TEXT
)