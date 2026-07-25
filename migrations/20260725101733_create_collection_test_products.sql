-- OzyBase Auto-Generated Migration
-- Description: create_collection_test_products

CREATE TABLE IF NOT EXISTS "test_products" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" TEXT NOT NULL,
	"price" NUMERIC DEFAULT '19.99',
	"in_stock" BOOL DEFAULT 'true',
	"metadata" JSONB,
	"created_at" TIMESTAMPTZ DEFAULT now()
)


			CREATE TRIGGER tr_notify_test_products
			AFTER INSERT OR UPDATE OR DELETE ON test_products
			FOR EACH ROW EXECUTE FUNCTION notify_event();
		