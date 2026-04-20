-- OzyBase Auto-Generated Migration
-- Description: create_collection_prueba01

CREATE TABLE IF NOT EXISTS "prueba01" (
	"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	"robloxianos" VARCHAR,
	"roblox" VARCHAR,
	"precio_de_los_robux" VARCHAR
)