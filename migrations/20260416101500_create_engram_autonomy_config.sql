-- Create autonomy governance config for Ozy Engram (L1/L2/L3).
CREATE TABLE IF NOT EXISTS _v_engram_config (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    autonomy_level TEXT NOT NULL DEFAULT 'L2' CHECK (autonomy_level IN ('L1', 'L2', 'L3')),
    last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL DEFAULT 'system'
);

INSERT INTO _v_engram_config (id, autonomy_level, last_updated, updated_by)
VALUES (TRUE, 'L2', NOW(), 'system')
ON CONFLICT (id) DO NOTHING;
