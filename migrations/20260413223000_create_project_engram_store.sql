CREATE TABLE IF NOT EXISTS _v_project_engram (
    id BIGSERIAL PRIMARY KEY,
    agent_token_id TEXT,
    agent_name TEXT NOT NULL DEFAULT 'MCP Agent',
    tool TEXT NOT NULL,
    operation_detail TEXT,
    target_resource TEXT,
    activity_kind TEXT,
    pipeline_fx TEXT,
    security_level TEXT,
    tool_risk TEXT,
    result TEXT,
    status_msg TEXT,
    latency_ms BIGINT,
    tool_arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_engram_created_at ON _v_project_engram (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_engram_target_resource ON _v_project_engram (target_resource);
CREATE INDEX IF NOT EXISTS idx_project_engram_tool ON _v_project_engram (tool);
CREATE INDEX IF NOT EXISTS idx_project_engram_pipeline_fx ON _v_project_engram (pipeline_fx);
