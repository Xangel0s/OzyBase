ALTER TABLE IF EXISTS _v_collections
ADD COLUMN IF NOT EXISTS is_protected BOOLEAN DEFAULT false;

UPDATE _v_collections
SET is_protected = true,
    updated_at = now()
WHERE name IN ('pc', 'usuarios', 'conexiones');
