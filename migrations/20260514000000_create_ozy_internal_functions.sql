-- Migration: Create ozy_internal schema and introspection functions
-- This migration is idempotent. All functions use CREATE OR REPLACE.
-- Security: Only service_role can execute these functions.

-- =============================================================================
-- 1. list_tables() — Returns user tables in the public schema
-- =============================================================================
CREATE OR REPLACE FUNCTION ozy_internal.list_tables()
RETURNS TABLE(name text, is_system boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT
        t.table_name::text AS name,
        (t.table_name LIKE '_v\_%' OR t.table_name LIKE '_ozy\_%') AS is_system
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name;
$$;

-- =============================================================================
-- 2. get_table_columns(tablename) — Returns column metadata for a table
-- =============================================================================
CREATE OR REPLACE FUNCTION ozy_internal.get_table_columns(tablename text)
RETURNS TABLE(
    name text,
    type text,
    udt text,
    nullable boolean,
    default_value text,
    is_pk boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT
        c.column_name::text,
        c.data_type::text,
        c.udt_name::text,
        (c.is_nullable = 'YES') AS nullable,
        c.column_default::text,
        COALESCE(pk.is_pk, false) AS is_pk
    FROM information_schema.columns c
    LEFT JOIN (
        SELECT kcu.column_name, true AS is_pk
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
            AND tc.table_name = kcu.table_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = tablename
          AND tc.constraint_type = 'PRIMARY KEY'
    ) pk ON pk.column_name = c.column_name
    WHERE c.table_schema = 'public'
      AND c.table_name = tablename
    ORDER BY c.ordinal_position;
$$;

-- =============================================================================
-- 3. get_foreign_keys(tablename) — Returns foreign key relationships
-- =============================================================================
CREATE OR REPLACE FUNCTION ozy_internal.get_foreign_keys(tablename text)
RETURNS TABLE(
    from_col text,
    to_table text,
    to_col text,
    constraint_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT
        kcu.column_name::text AS from_col,
        ccu.table_name::text AS to_table,
        ccu.column_name::text AS to_col,
        tc.constraint_name::text
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
    JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = tablename;
$$;

-- =============================================================================
-- 4. get_table_ddl(tablename) — Full DDL reconstruction for a table
-- Uses native PostgreSQL functions: pg_get_indexdef(), pg_get_constraintdef(),
-- format_type(), pg_get_expr().
-- =============================================================================
CREATE OR REPLACE FUNCTION ozy_internal.get_table_ddl(tablename text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    result text := '';
    col_record record;
    const_record record;
    idx_record record;
    rls_enabled boolean;
    force_rls boolean;
    pol_record record;
    col_count int;
BEGIN
    -- Get column count first to verify table exists
    SELECT COUNT(*) INTO col_count
    FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = tablename
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF col_count = 0 THEN
        RETURN '-- Table not found: ' || tablename;
    END IF;

    -- CREATE TABLE header
    result := 'CREATE TABLE public.' || quote_ident(tablename) || ' (' || E'\n';

    -- Columns
    FOR col_record IN
        SELECT
            a.attname,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
            a.attnotnull,
            pg_get_expr(ad.adbin, ad.adrelid) AS column_default
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE n.nspname = 'public'
          AND c.relname = tablename
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY a.attnum
    LOOP
        result := result || '    ' || quote_ident(col_record.attname) || ' ' || col_record.formatted_type;
        IF col_record.column_default IS NOT NULL THEN
            result := result || ' DEFAULT ' || col_record.column_default;
        END IF;
        IF col_record.attnotnull THEN
            result := result || ' NOT NULL';
        END IF;
        result := result || ',' || E'\n';
    END LOOP;

    -- Constraints (PK, FK, UNIQUE, CHECK)
    FOR const_record IN
        SELECT
            con.conname,
            pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_catalog.pg_constraint con
        JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = tablename
          AND con.contype IN ('p', 'u', 'f', 'c', 'x')
        ORDER BY
            CASE con.contype
                WHEN 'p' THEN 0
                WHEN 'u' THEN 1
                WHEN 'f' THEN 2
                WHEN 'c' THEN 3
                WHEN 'x' THEN 4
                ELSE 5
            END,
            con.conname
    LOOP
        result := result || '    CONSTRAINT ' || quote_ident(const_record.conname) || ' ' || const_record.definition || ',' || E'\n';
    END LOOP;

    -- Remove trailing comma and close CREATE TABLE
    result := rtrim(result, ',' || E'\n') || E'\n);' || E'\n';

    -- Indexes (non-constraint)
    FOR idx_record IN
        SELECT
            ci.relname,
            pg_get_indexdef(i.indexrelid, 0, true) AS definition
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_catalog.pg_class ci ON ci.oid = i.indexrelid
        LEFT JOIN pg_catalog.pg_constraint con ON con.conindid = i.indexrelid
        WHERE n.nspname = 'public'
          AND c.relname = tablename
          AND con.oid IS NULL
        ORDER BY ci.relname
    LOOP
        result := result || E'\n-- Indexes' || E'\n' || idx_record.definition || ';' || E'\n';
    END LOOP;

    -- RLS
    SELECT c.relrowsecurity, c.relforcerowsecurity
    INTO rls_enabled, force_rls
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = tablename;

    IF rls_enabled THEN
        result := result || E'\n-- Row level security' || E'\n';
        result := result || 'ALTER TABLE public.' || quote_ident(tablename) || ' ENABLE ROW LEVEL SECURITY;' || E'\n';
        IF force_rls THEN
            result := result || 'ALTER TABLE public.' || quote_ident(tablename) || ' FORCE ROW LEVEL SECURITY;' || E'\n';
        END IF;

        FOR pol_record IN
            SELECT
                p.policyname,
                p.permissive,
                p.roles,
                p.cmd,
                p.qual,
                p.with_check
            FROM pg_catalog.pg_policies p
            WHERE p.schemaname = 'public' AND p.tablename = tablename
            ORDER BY p.policyname
        LOOP
            result := result || 'CREATE POLICY ' || quote_ident(pol_record.policyname);
            result := result || ' ON public.' || quote_ident(tablename);
            result := result || ' AS ' || upper(pol_record.permissive);
            result := result || ' FOR ' || upper(pol_record.cmd);
            IF array_length(pol_record.roles, 1) > 0 THEN
                result := result || ' TO ' || array_to_string(pol_record.roles, ', ');
            END IF;
            IF pol_record.qual IS NOT NULL THEN
                result := result || ' USING (' || pol_record.qual || ')';
            END IF;
            IF pol_record.with_check IS NOT NULL THEN
                result := result || ' WITH CHECK (' || pol_record.with_check || ')';
            END IF;
            result := result || ';' || E'\n';
        END LOOP;
    END IF;

    RETURN result;
END;
$$;

-- =============================================================================
-- 5. get_all_foreign_keys() — Returns ALL foreign key relationships in public
-- =============================================================================
CREATE OR REPLACE FUNCTION ozy_internal.get_all_foreign_keys()
RETURNS TABLE(
    from_table text,
    from_col text,
    to_table text,
    to_col text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT
        tc.table_name::text AS from_table,
        kcu.column_name::text AS from_col,
        ccu.table_name::text AS to_table,
        ccu.column_name::text AS to_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
    JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name, kcu.ordinal_position;
$$;

-- =============================================================================
-- Grant permissions: only service_role can execute
-- =============================================================================
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ozy_internal FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ozy_internal TO service_role;
