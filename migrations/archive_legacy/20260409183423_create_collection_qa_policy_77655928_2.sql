-- OzyBase Auto-Generated Migration
-- Description: create_collection_qa_policy_77655928_2

CREATE TABLE IF NOT EXISTS "qa_policy_77655928_2" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"owner_id" TEXT,
	"title" TEXT
)