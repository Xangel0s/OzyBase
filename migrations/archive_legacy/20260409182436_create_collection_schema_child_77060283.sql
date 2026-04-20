-- OzyBase Auto-Generated Migration
-- Description: create_collection_schema_child_77060283

CREATE TABLE IF NOT EXISTS "schema_child_77060283" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" UUID REFERENCES "schema_parent_77060283"("id") ON DELETE CASCADE,
	"summary" TEXT
)