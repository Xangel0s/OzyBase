-- OzyBase Auto-Generated Migration
-- Description: create_collection_nodenode

CREATE TABLE IF NOT EXISTS "nodenode" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"coso" VARCHAR
)


			CREATE TRIGGER tr_notify_nodenode
			AFTER INSERT OR UPDATE OR DELETE ON nodenode
			FOR EACH ROW EXECUTE FUNCTION notify_event();
		