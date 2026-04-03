package api

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"
)

type recordingMigrationTx struct {
	execSQLs      []string
	execArgCounts []int
}

func (r *recordingMigrationTx) Begin(context.Context) (pgx.Tx, error) {
	panic("unexpected Begin call in test")
}

func (r *recordingMigrationTx) Commit(context.Context) error {
	panic("unexpected Commit call in test")
}

func (r *recordingMigrationTx) Rollback(context.Context) error {
	panic("unexpected Rollback call in test")
}

func (r *recordingMigrationTx) CopyFrom(context.Context, pgx.Identifier, []string, pgx.CopyFromSource) (int64, error) {
	panic("unexpected CopyFrom call in test")
}

func (r *recordingMigrationTx) SendBatch(context.Context, *pgx.Batch) pgx.BatchResults {
	panic("unexpected SendBatch call in test")
}

func (r *recordingMigrationTx) LargeObjects() pgx.LargeObjects {
	panic("unexpected LargeObjects call in test")
}

func (r *recordingMigrationTx) Prepare(context.Context, string, string) (*pgconn.StatementDescription, error) {
	panic("unexpected Prepare call in test")
}

func (r *recordingMigrationTx) Exec(_ context.Context, sql string, arguments ...any) (pgconn.CommandTag, error) {
	r.execSQLs = append(r.execSQLs, sql)
	r.execArgCounts = append(r.execArgCounts, len(arguments))
	return pgconn.CommandTag{}, nil
}

func (r *recordingMigrationTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	panic("unexpected Query call in test")
}

func (r *recordingMigrationTx) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("unexpected QueryRow call in test")
}

func (r *recordingMigrationTx) Conn() *pgx.Conn {
	return nil
}

func TestMigrationInsertBatchSize_RespectsPostgresParameterLimit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		columnCount int
		want        int
		wantErr     bool
	}{
		{name: "caps to configured batch size", columnCount: 4, want: setupMigrationMaxRowsPerInsertBatch},
		{name: "falls back to protocol limit", columnCount: 70, want: 936},
		{name: "rejects empty column set", columnCount: 0, wantErr: true},
		{name: "rejects single row above protocol limit", columnCount: setupMigrationMaxInsertParameters + 1, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			got, err := migrationInsertBatchSize(tt.columnCount)
			if tt.wantErr {
				require.Error(t, err)
				return
			}

			require.NoError(t, err)
			require.Equal(t, tt.want, got)
		})
	}
}

func TestInsertMigrationRowsTx_BatchesLargeImportsBelowPostgresParameterLimit(t *testing.T) {
	t.Parallel()

	const (
		columnCount = 70
		rowCount    = 1000
	)

	schema := make([]data.FieldSchema, 0, columnCount)
	rows := make([]map[string]any, 0, rowCount)
	for columnIndex := range columnCount {
		schema = append(schema, data.FieldSchema{
			Name: fmt.Sprintf("field_%02d", columnIndex),
			Type: "number",
		})
	}

	for rowIndex := range rowCount {
		record := make(map[string]any, columnCount)
		for columnIndex := range columnCount {
			record[fmt.Sprintf("field_%02d", columnIndex)] = rowIndex + columnIndex
		}
		rows = append(rows, record)
	}

	tx := &recordingMigrationTx{}
	inserted, err := insertMigrationRowsTx(context.Background(), tx, setupMigrationTablePlan{
		Name:   "document",
		Schema: schema,
		Rows:   rows,
	})
	require.NoError(t, err)
	require.Equal(t, rowCount, inserted)
	require.Len(t, tx.execSQLs, 2)
	require.Equal(t, []int{936 * columnCount, 64 * columnCount}, tx.execArgCounts)

	for index, sql := range tx.execSQLs {
		require.True(t, strings.HasPrefix(sql, "INSERT INTO document"), "batch %d SQL should target document table", index)
		require.LessOrEqual(t, tx.execArgCounts[index], setupMigrationMaxInsertParameters)
	}
}
