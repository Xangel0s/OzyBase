-- Auto-sync metadata and security for user-created tables.
-- Goal: keep physical PostgreSQL tables and OzyBase metadata (_v_collections)
-- in the same transaction scope whenever CREATE TABLE is executed.

CREATE OR REPLACE FUNCTION _v_build_collection_schema_def(p_schema text, p_table text)
RETURNS jsonb
LANGUAGE sql
AS $$
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'name', c.column_name,
                'type', c.udt_name,
                'required', (c.is_nullable = 'NO')
            )
            ORDER BY c.ordinal_position
        ),
        '[]'::jsonb
    )
    FROM information_schema.columns c
    WHERE c.table_schema = p_schema
      AND c.table_name = p_table;
$$;

CREATE OR REPLACE FUNCTION _v_sync_collection_metadata(p_schema text, p_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_workspace_id uuid;
    v_schema_def jsonb;
BEGIN
    IF p_schema IS NULL OR p_table IS NULL THEN
        RETURN;
    END IF;

    -- Scope only to user tables in public schema.
    IF p_schema <> 'public' THEN
        RETURN;
    END IF;
    IF p_table LIKE '\_v\_%' ESCAPE '\' THEN
        RETURN;
    END IF;

    SELECT id
    INTO v_workspace_id
    FROM _v_workspaces
    ORDER BY created_at ASC
    LIMIT 1;

    SELECT _v_build_collection_schema_def(p_schema, p_table)
    INTO v_schema_def;

    INSERT INTO _v_collections (
        name,
        display_name,
        schema_def,
        workspace_id,
        rls_enabled,
        updated_at
    )
    VALUES (
        p_table,
        p_table,
        v_schema_def,
        v_workspace_id,
        true,
        NOW()
    )
    ON CONFLICT (name) DO UPDATE
    SET
        schema_def = EXCLUDED.schema_def,
        workspace_id = COALESCE(_v_collections.workspace_id, EXCLUDED.workspace_id),
        rls_enabled = true,
        updated_at = NOW();

    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', p_schema, p_table);
END;
$$;

CREATE OR REPLACE FUNCTION _v_on_create_table_sync()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
    cmd record;
    v_schema text;
    v_table text;
BEGIN
    FOR cmd IN
        SELECT objid
        FROM pg_event_trigger_ddl_commands()
        WHERE command_tag = 'CREATE TABLE'
          AND object_type = 'table'
    LOOP
        SELECT n.nspname, c.relname
        INTO v_schema, v_table
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.oid = cmd.objid;

        IF FOUND THEN
            PERFORM _v_sync_collection_metadata(v_schema, v_table);
        END IF;
    END LOOP;
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_event_trigger
        WHERE evtname = 'v_on_create_table_sync'
    ) THEN
        CREATE EVENT TRIGGER v_on_create_table_sync
        ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE')
        EXECUTE FUNCTION _v_on_create_table_sync();
    END IF;
END $$;

-- One-time backfill: sync any existing user tables missing/partially configured metadata.
DO $$
DECLARE
    rec record;
BEGIN
    FOR rec IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT LIKE '\_v\_%' ESCAPE '\'
    LOOP
        PERFORM _v_sync_collection_metadata(rec.schemaname, rec.tablename);
    END LOOP;
END $$;

