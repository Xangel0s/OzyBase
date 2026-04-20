-- OzyBase Auto-Generated Migration
-- Description: create_collection_qa_theme_77060281

CREATE TABLE IF NOT EXISTS "qa_theme_77060281" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" TEXT,
	"status" TEXT,
	"stage" TEXT,
	"amount" INT8,
	"score" INT8,
	"owner" TEXT
)