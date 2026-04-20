-- OzyBase Auto-Generated Migration
-- Description: create_collection_prueba01

CREATE TABLE IF NOT EXISTS "prueba01" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"documento" VARCHAR,
	"departamento" VARCHAR,
	"tamaño" VARCHAR
);


CREATE TRIGGER tr_notify_prueba01
AFTER INSERT OR UPDATE OR DELETE ON prueba01
FOR EACH ROW EXECUTE FUNCTION notify_event();
		
