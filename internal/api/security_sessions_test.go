package api

import "testing"

func TestNormalizeSessionTerminationIP(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		raw     string
		want    string
		wantErr bool
	}{
		{name: "ipv4", raw: "203.0.113.10", want: "203.0.113.10", wantErr: false},
		{name: "ipv6 mapped normalized", raw: "::ffff:203.0.113.10", want: "203.0.113.10", wantErr: false},
		{name: "trim spaces", raw: " 198.51.100.22 ", want: "198.51.100.22", wantErr: false},
		{name: "invalid", raw: "bad-ip", want: "", wantErr: true},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := normalizeSessionTerminationIP(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for %q", tc.raw)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestNormalizeCountryCode(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "uppercase", raw: "US", want: "US"},
		{name: "trim and upper", raw: " pe ", want: "PE"},
		{name: "invalid len", raw: "USA", want: ""},
		{name: "invalid chars", raw: "9X", want: ""},
		{name: "empty", raw: "", want: ""},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := normalizeCountryCode(tc.raw); got != tc.want {
				t.Fatalf("normalizeCountryCode(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}
