-- OzyBase Auto-Generated Migration
-- Description: create_collection_qa_live_76564951

CREATE TABLE IF NOT EXISTS "qa_live_76564951" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" TEXT,
	"status" TEXT,
	"amount" INT8,
	"owner" TEXT
);


			CREATE TRIGGER tr_notify_qa_live_76564951
			AFTER INSERT OR UPDATE OR DELETE ON qa_live_76564951
			FOR EACH ROW EXECUTE FUNCTION notify_event();
		