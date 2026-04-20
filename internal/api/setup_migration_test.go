package api

import (
	"encoding/json"
	"testing"
)

func TestNormalizeBooleanValueAcceptsNumericBooleanLiterals(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name string
		raw  any
		want bool
	}{
		{name: "int zero", raw: 0, want: false},
		{name: "int one", raw: 1, want: true},
		{name: "int64 zero", raw: int64(0), want: false},
		{name: "int64 one", raw: int64(1), want: true},
		{name: "float zero", raw: float64(0), want: false},
		{name: "float one", raw: float64(1), want: true},
		{name: "json number zero", raw: json.Number("0"), want: false},
		{name: "json number one", raw: json.Number("1"), want: true},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := normalizeBooleanValue(tc.raw)
			if err != nil {
				t.Fatalf("normalizeBooleanValue(%v) returned error: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Fatalf("normalizeBooleanValue(%v) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestNormalizeBooleanValueRejectsUnexpectedNumericLiteral(t *testing.T) {
	t.Parallel()

	if _, err := normalizeBooleanValue(2); err == nil {
		t.Fatal("expected numeric boolean normalization to reject 2")
	}
}
