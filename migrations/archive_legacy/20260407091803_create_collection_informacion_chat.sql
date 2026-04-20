-- OzyBase Auto-Generated Migration
-- Description: create_collection_informacion_chat

CREATE TABLE IF NOT EXISTS "informacion_chat" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"usuario" VARCHAR,
	"fecha" DATE,
	"destacado" NUMERIC,
	"registro_de_llamadas" NUMERIC,
	"imagenes" NUMERIC,
	"videos" NUMERIC
)