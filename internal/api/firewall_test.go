package api

import (
	"context"
	"errors"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
)

type mockFirewallRuleStore struct {
	rules []firewallIPRule
	err   error
}

func (m *mockFirewallRuleStore) LoadActiveIPRules(_ context.Context) ([]firewallIPRule, error) {
	if m.err != nil {
		return nil, m.err
	}
	return append([]firewallIPRule(nil), m.rules...), nil
}

func TestFirewallEvaluatePrecedence(t *testing.T) {
	t.Parallel()

	mustPrefix := func(value string) netip.Prefix {
		t.Helper()
		p, err := netip.ParsePrefix(value)
		if err != nil {
			t.Fatalf("parse prefix %q: %v", value, err)
		}
		return p
	}

	mustIP := func(value string) netip.Addr {
		t.Helper()
		ip, err := netip.ParseAddr(value)
		if err != nil {
			t.Fatalf("parse ip %q: %v", value, err)
		}
		return ip
	}

	tests := []struct {
		name       string
		engine     firewallEngine
		clientIP   string
		remoteAddr string
		path       string
		headers    map[string]string
		want       string
		wantReason string
	}{
		{
			name: "internal bypass path",
			engine: firewallEngine{
				mode: firewallModeEnforce,
			},
			clientIP:   "8.8.8.8",
			remoteAddr: "8.8.8.8:1234",
			path:       "/api/health",
			want:       "allow",
			wantReason: "BYPASS_INTERNAL",
		},
		{
			name: "deny has precedence over allow",
			engine: firewallEngine{
				mode:        firewallModeEnforce,
				allowedNets: []netip.Prefix{mustPrefix("10.0.0.0/8")},
				deniedNets:  []netip.Prefix{mustPrefix("10.10.0.0/16")},
			},
			clientIP:   "10.10.1.25",
			remoteAddr: "10.10.1.25:9000",
			path:       "/api/auth/login",
			want:       "block",
			wantReason: "IP_BLOCKED",
		},
		{
			name: "allow list bypasses geo",
			engine: firewallEngine{
				mode:             firewallModeEnforce,
				allowedNets:      []netip.Prefix{mustPrefix("200.48.100.0/24")},
				allowedCountries: map[string]struct{}{"PE": {}},
				geoLookupOverride: func(netip.Addr) (string, error) {
					return "US", nil
				},
			},
			clientIP:   "200.48.100.5",
			remoteAddr: "200.48.100.5:9000",
			path:       "/api/auth/login",
			want:       "allow",
			wantReason: "IP_ALLOWED",
		},
		{
			name: "country not allowed blocks",
			engine: firewallEngine{
				mode:             firewallModeEnforce,
				allowedCountries: map[string]struct{}{"PE": {}},
				geoLookupOverride: func(netip.Addr) (string, error) {
					return "US", nil
				},
			},
			clientIP:   "190.1.2.3",
			remoteAddr: "190.1.2.3:9000",
			path:       "/api/auth/login",
			want:       "block",
			wantReason: "COUNTRY_NOT_ALLOWED",
		},
		{
			name: "geo lookup error is blocked in enforce",
			engine: firewallEngine{
				mode:             firewallModeEnforce,
				allowedCountries: map[string]struct{}{"PE": {}},
				geoLookupOverride: func(netip.Addr) (string, error) {
					return "", errors.New("db down")
				},
			},
			clientIP:   "190.1.2.3",
			remoteAddr: "190.1.2.3:9000",
			path:       "/api/auth/login",
			want:       "block",
			wantReason: "GEO_DB_ERROR",
		},
		{
			name: "geo lookup error is allowed in log-only",
			engine: firewallEngine{
				mode:             firewallModeLogOnly,
				allowedCountries: map[string]struct{}{"PE": {}},
				geoLookupOverride: func(netip.Addr) (string, error) {
					return "", errors.New("db down")
				},
			},
			clientIP:   "190.1.2.3",
			remoteAddr: "190.1.2.3:9000",
			path:       "/api/auth/login",
			want:       "allow",
			wantReason: "LOG_ONLY",
		},
		{
			name: "trust forwarded for only from trusted proxy",
			engine: firewallEngine{
				mode:           firewallModeEnforce,
				trustedProxies: []netip.Prefix{mustPrefix("127.0.0.1/32")},
				deniedNets:     []netip.Prefix{mustPrefix("203.0.113.0/24")},
			},
			clientIP:   "127.0.0.1",
			remoteAddr: "127.0.0.1:5000",
			path:       "/api/auth/login",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.45"},
			want:       "block",
			wantReason: "IP_BLOCKED",
		},
		{
			name: "ignores forwarded for from untrusted proxy",
			engine: firewallEngine{
				mode:           firewallModeEnforce,
				trustedProxies: []netip.Prefix{mustPrefix("10.0.0.0/8")},
				deniedNets:     []netip.Prefix{mustPrefix("203.0.113.0/24")},
			},
			clientIP:   "198.51.100.12",
			remoteAddr: "198.51.100.12:5000",
			path:       "/api/auth/login",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.45"},
			want:       "allow",
			wantReason: "DEFAULT_ALLOW",
		},
	}

	for i := range tests {
		tt := &tests[i]
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			e := echo.New()
			req := httptest.NewRequest("GET", tt.path, nil)
			req.RemoteAddr = tt.remoteAddr
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			rec := httptest.NewRecorder()
			ctx := e.NewContext(req, rec)

			if tt.clientIP != "" {
				ip := mustIP(tt.clientIP)
				_ = ip
			}

			got, gotReason := tt.engine.evaluate(ctx)
			if got != tt.want || gotReason != tt.wantReason {
				t.Fatalf("evaluate() = (%s,%s), want (%s,%s)", got, gotReason, tt.want, tt.wantReason)
			}
		})
	}
}

func TestParsePrefixesFromCSV(t *testing.T) {
	t.Parallel()

	prefixes, err := parsePrefixesFromCSV("192.168.1.0/24, 200.48.10.5")
	if err != nil {
		t.Fatalf("parsePrefixesFromCSV returned error: %v", err)
	}
	if len(prefixes) != 2 {
		t.Fatalf("expected 2 prefixes, got %d", len(prefixes))
	}

	if _, err := parsePrefixesFromCSV("not-an-ip"); err == nil {
		t.Fatal("expected invalid ip error")
	}
}

func TestFirewallDynamicRulesFromStore(t *testing.T) {
	t.Parallel()

	engine := firewallEngine{
		mode:                firewallModeEnforce,
		dynamicRuleStore:    &mockFirewallRuleStore{rules: []firewallIPRule{{IPAddress: "203.0.113.0/24", RuleType: "BLOCK"}, {IPAddress: "198.51.100.10", RuleType: "ALLOW"}}},
		dynamicRuleCacheTTL: 2 * time.Second,
	}

	e := echo.New()

	reqBlocked := httptest.NewRequest("GET", "/api/auth/login", nil)
	reqBlocked.RemoteAddr = "203.0.113.25:4000"
	ctxBlocked := e.NewContext(reqBlocked, httptest.NewRecorder())
	decision, reason := engine.evaluate(ctxBlocked)
	if decision != "block" || reason != "IP_BLOCKED_DYNAMIC" {
		t.Fatalf("blocked decision = (%s,%s), want (block,IP_BLOCKED_DYNAMIC)", decision, reason)
	}

	reqAllowed := httptest.NewRequest("GET", "/api/auth/login", nil)
	reqAllowed.RemoteAddr = "198.51.100.10:4000"
	ctxAllowed := e.NewContext(reqAllowed, httptest.NewRecorder())
	decision, reason = engine.evaluate(ctxAllowed)
	if decision != "allow" || reason != "IP_ALLOWED_DYNAMIC" {
		t.Fatalf("allow decision = (%s,%s), want (allow,IP_ALLOWED_DYNAMIC)", decision, reason)
	}
}

func TestParseIPOrCIDR(t *testing.T) {
	t.Parallel()

	if _, ok := parseIPOrCIDR("203.0.113.5"); !ok {
		t.Fatal("expected single IP to parse")
	}
	if _, ok := parseIPOrCIDR("203.0.113.0/24"); !ok {
		t.Fatal("expected CIDR to parse")
	}
	if _, ok := parseIPOrCIDR("bad-value"); ok {
		t.Fatal("expected invalid value to fail parse")
	}
}

func TestFirewallBlockedAttemptIncrementsMetrics(t *testing.T) {
	t.Parallel()

	collector := newSecurityMetricsCollectorFromEnv(nil)
	engine := firewallEngine{
		mode:       firewallModeEnforce,
		deniedNets: []netip.Prefix{mustTestPrefix(t, "203.0.113.0/24")},
		metrics:    collector,
	}

	e := echo.New()
	req := httptest.NewRequest("GET", "/api/auth/login", nil)
	req.RemoteAddr = "203.0.113.22:8080"
	ctx := e.NewContext(req, httptest.NewRecorder())

	decision, reason := engine.evaluate(ctx)
	if decision != "block" || reason != "IP_BLOCKED" {
		t.Fatalf("evaluate = (%s,%s), want (block,IP_BLOCKED)", decision, reason)
	}

	metrics, err := collector.Snapshot(context.Background(), 24)
	if err != nil {
		t.Fatalf("snapshot error: %v", err)
	}
	if metrics.TotalBlocked < 1 {
		t.Fatalf("expected blocked attempts >=1, got %d", metrics.TotalBlocked)
	}
	if len(metrics.ByReason) == 0 || metrics.ByReason[0].Label != "IP_BLOCKED" {
		t.Fatalf("expected top reason IP_BLOCKED, got %+v", metrics.ByReason)
	}
}

func TestSecurityMetricsCollectorSnapshotOrdering(t *testing.T) {
	t.Parallel()

	collector := newSecurityMetricsCollectorFromEnv(nil)
	collector.RecordBlock("203.0.113.2", "PE", "COUNTRY_BLOCKED")
	collector.RecordBlock("203.0.113.2", "PE", "COUNTRY_BLOCKED")
	collector.RecordBlock("198.51.100.8", "US", "IP_BLOCKED_DYNAMIC")

	metrics, err := collector.Snapshot(context.Background(), 24)
	if err != nil {
		t.Fatalf("snapshot error: %v", err)
	}
	if metrics.TotalBlocked != 3 {
		t.Fatalf("total blocked = %d, want 3", metrics.TotalBlocked)
	}
	if len(metrics.ByReason) == 0 || metrics.ByReason[0].Label != "COUNTRY_BLOCKED" || metrics.ByReason[0].Count != 2 {
		t.Fatalf("unexpected reason ordering: %+v", metrics.ByReason)
	}
	if len(metrics.TopCountries) == 0 || metrics.TopCountries[0].Label != "PE" {
		t.Fatalf("unexpected country ordering: %+v", metrics.TopCountries)
	}
}

func mustTestPrefix(t *testing.T, raw string) netip.Prefix {
	t.Helper()
	prefix, err := netip.ParsePrefix(raw)
	if err != nil {
		t.Fatalf("invalid test prefix %q: %v", raw, err)
	}
	return prefix
}
