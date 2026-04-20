-- OzyBase Auto-Generated Migration
-- Description: create_collection_schema_child_74789625

CREATE TABLE IF NOT EXISTS "schema_child_74789625" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" UUID REFERENCES "schema_parent_74789625"("id") ON DELETE CASCADE,
	"summary" TEXT
)