DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'mcp_security_level'
    ) THEN
        CREATE TYPE mcp_security_level AS ENUM ('libre', 'medio', 'restringido');
    END IF;
END $$;

ALTER TABLE "_v_api_keys"
ADD COLUMN IF NOT EXISTS security_level mcp_security_level DEFAULT 'libre';

UPDATE "_v_api_keys"
SET security_level = 'restringido'
WHERE role = 'service_role'
  AND (security_level IS NULL OR security_level = 'libre');

CREATE TABLE IF NOT EXISTS "_v_mcp_approvals" (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id UUID,
    token_security_level mcp_security_level NOT NULL,
    workspace_id UUID,
    actor_subject TEXT,
    tool TEXT NOT NULL,
    arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT NOT NULL DEFAULT '',
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejected_by UUID,
    rejected_at TIMESTAMPTZ,
    resolved_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT mcp_approvals_status_check CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_mcp_approvals_status_created_at
    ON "_v_mcp_approvals" (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_approvals_token_id
    ON "_v_mcp_approvals" (token_id);

CREATE INDEX IF NOT EXISTS idx_mcp_approvals_workspace_id
    ON "_v_mcp_approvals" (workspace_id);
