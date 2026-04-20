-- OzyBase Auto-Generated Migration
-- Description: create_collection_qa_live_73964564

CREATE TABLE IF NOT EXISTS "qa_live_73964564" (
	"title" TEXT,
	"status" TEXT,
	"amount" INT8,
	"owner" TEXT
);


			CREATE TRIGGER tr_notify_qa_live_73964564
			AFTER INSERT OR UPDATE OR DELETE ON qa_live_73964564
			FOR EACH ROW EXECUTE FUNCTION notify_event();
		