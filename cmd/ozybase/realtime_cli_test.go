package main

import "testing"

func TestValidateIdentifier(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		kind      string
		value     string
		wantError bool
	}{
		{name: "valid simple", kind: "table", value: "orders", wantError: false},
		{name: "valid underscore", kind: "slot", value: "ozybase_realtime_slot", wantError: false},
		{name: "invalid hyphen", kind: "publication", value: "bad-name", wantError: true},
		{name: "invalid leading number", kind: "schema", value: "1public", wantError: true},
		{name: "empty", kind: "table", value: "   ", wantError: true},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := validateIdentifier(tc.kind, tc.value)
			if tc.wantError && err == nil {
				t.Fatalf("expected error for value %q", tc.value)
			}
			if !tc.wantError && err != nil {
				t.Fatalf("did not expect error for value %q: %v", tc.value, err)
			}
		})
	}
}
