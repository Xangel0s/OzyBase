ALTER TABLE IF EXISTS _v_project_engram
    ADD COLUMN IF NOT EXISTS is_compacted BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS compacted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS compaction_batch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_project_engram_compacted_created_at
    ON _v_project_engram (is_compacted, created_at DESC);
