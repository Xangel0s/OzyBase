package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/netip"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/labstack/echo/v4"
	"github.com/oschwald/maxminddb-golang"
)

type firewallMode string

const (
	firewallModeOff     firewallMode = "off"
	firewallModeLogOnly firewallMode = "log-only"
	firewallModeEnforce firewallMode = "enforce"
)

type firewallEngine struct {
	mode              firewallMode
	auditHeader       bool
	allowedNets       []netip.Prefix
	deniedNets        []netip.Prefix
	trustedProxies    []netip.Prefix
	allowedCountries  map[string]struct{}
	blockedCountries  map[string]struct{}
	maxmindPath       string
	maxmindDB         *maxminddb.Reader
	geoLookupOverride func(netip.Addr) (string, error)

	dynamicRuleStore      firewallRuleStore
	dynamicRuleCacheTTL   time.Duration
	dynamicRulesMu        sync.RWMutex
	dynamicRulesLoadedAt  time.Time
	dynamicAllowedNets    []netip.Prefix
	dynamicBlockedNets    []netip.Prefix
	dynamicRefreshBackoff time.Duration
	metrics               *securityMetricsCollector
}

type securityMetricsStorage string

const (
	securityMetricsStorageMemory   securityMetricsStorage = "memory"
	securityMetricsStoragePostgres securityMetricsStorage = "postgres"
)

type securityMetricKey struct {
	BucketStart time.Time
	SourceIP    string
	CountryCode string
	Reason      string
}

type securityMetricsCollector struct {
	storage        securityMetricsStorage
	db             *data.DB
	flushInterval  time.Duration
	flushThreshold int64
	entries        sync.Map // map[securityMetricKey]*atomic.Int64
	pending        atomic.Int64
	flushing       atomic.Bool
	lastFlushUnix  atomic.Int64
}

type firewallMetricsRow struct {
	Label string `json:"label"`
	Count int64  `json:"count"`
}

type firewallMetricsResponse struct {
	Storage      string               `json:"storage"`
	WindowHours  int                  `json:"window_hours"`
	TotalBlocked int64                `json:"total_blocked"`
	ByReason     []firewallMetricsRow `json:"by_reason"`
	TopCountries []firewallMetricsRow `json:"top_countries"`
	TopIPs       []firewallMetricsRow `json:"top_ips"`
	Pending      int64                `json:"pending_buffer"`
	LastFlushAt  *time.Time           `json:"last_flush_at,omitempty"`
}

type firewallRuleStore interface {
	LoadActiveIPRules(ctx context.Context) ([]firewallIPRule, error)
}

type firewallIPRule struct {
	IPAddress string
	RuleType  string
}

type firewallDBRuleStore struct {
	db *data.DB
}

type IPRule struct {
	ID        string     `json:"id"`
	IPAddress string     `json:"ip_address"`
	RuleType  string     `json:"rule_type"`
	Reason    string     `json:"reason"`
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
}

// FirewallMiddleware checks every request against the IP blacklist/whitelist
func (h *Handler) FirewallMiddleware() echo.MiddlewareFunc {
	engine, err := newFirewallEngineFromEnv(&firewallDBRuleStore{db: h.DB})
	if err != nil {
		log.Fatalf("[FIREWALL] initialization failed: %v", err)
	}
	engine.metrics = newSecurityMetricsCollectorFromEnv(h.DB)
	if engine.metrics != nil {
		engine.metrics.Start(context.Background())
	}
	h.firewallEngine = engine

	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			decision, reason := engine.evaluate(c)
			if engine.auditHeader {
				c.Response().Header().Set("X-Ozy-Firewall", fmt.Sprintf("%s:%s", decision, reason))
			}
			if decision == "block" {
				return c.JSON(http.StatusForbidden, map[string]string{
					"error": "Access denied by firewall policy",
					"code":  reason,
				})
			}
			return next(c)
		}
	}
}

func (h *Handler) GetFirewallMetrics(c echo.Context) error {
	if h == nil || h.firewallEngine == nil || h.firewallEngine.metrics == nil {
		return c.JSON(http.StatusOK, firewallMetricsResponse{Storage: string(securityMetricsStorageMemory), WindowHours: 24})
	}

	hours := parseIntDefault(strings.TrimSpace(c.QueryParam("hours")), 24)
	if hours > 168 {
		hours = 168
	}

	metrics, err := h.firewallEngine.metrics.Snapshot(c.Request().Context(), hours)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to build firewall metrics"})
	}
	return c.JSON(http.StatusOK, metrics)
}

func newFirewallEngineFromEnv(ruleStore firewallRuleStore) (*firewallEngine, error) {
	mode := parseFirewallMode(strings.TrimSpace(os.Getenv("OZY_FIREWALL_MODE")))
	if mode == firewallModeOff {
		return &firewallEngine{mode: firewallModeOff, auditHeader: parseBoolDefault(os.Getenv("OZY_FIREWALL_AUDIT_HEADER"), true), dynamicRuleStore: ruleStore}, nil
	}

	allowedNets, err := parsePrefixesFromCSV(os.Getenv("OZY_ALLOWED_IPS"))
	if err != nil {
		return nil, fmt.Errorf("parse OZY_ALLOWED_IPS: %w", err)
	}
	deniedNets, err := parsePrefixesFromCSV(firewallFirstNonEmpty(strings.TrimSpace(os.Getenv("OZY_BLOCKED_IPS")), strings.TrimSpace(os.Getenv("OZY_DENIED_IPS"))))
	if err != nil {
		return nil, fmt.Errorf("parse OZY_BLOCKED_IPS: %w", err)
	}
	trustedProxies, err := parsePrefixesFromCSV(os.Getenv("OZY_TRUSTED_PROXIES"))
	if err != nil {
		return nil, fmt.Errorf("parse OZY_TRUSTED_PROXIES: %w", err)
	}

	allowedCountries := parseCountrySet(os.Getenv("OZY_ALLOWED_COUNTRIES"))
	blockedCountries := parseCountrySet(os.Getenv("OZY_BLOCKED_COUNTRIES"))
	maxmindPath := strings.TrimSpace(os.Getenv("OZY_MAXMIND_DB"))

	engine := &firewallEngine{
		mode:                  mode,
		auditHeader:           parseBoolDefault(os.Getenv("OZY_FIREWALL_AUDIT_HEADER"), true),
		allowedNets:           allowedNets,
		deniedNets:            deniedNets,
		trustedProxies:        trustedProxies,
		allowedCountries:      allowedCountries,
		blockedCountries:      blockedCountries,
		maxmindPath:           maxmindPath,
		dynamicRuleStore:      ruleStore,
		dynamicRuleCacheTTL:   time.Duration(parseIntDefault(strings.TrimSpace(os.Getenv("OZY_FIREWALL_DYNAMIC_CACHE_SECONDS")), 3)) * time.Second,
		dynamicRefreshBackoff: 300 * time.Millisecond,
	}
	if engine.dynamicRuleCacheTTL <= 0 {
		engine.dynamicRuleCacheTTL = 3 * time.Second
	}

	geoRequired := len(allowedCountries) > 0 || len(blockedCountries) > 0
	if geoRequired {
		if strings.TrimSpace(maxmindPath) == "" {
			if mode == firewallModeEnforce {
				return nil, errors.New("geofencing enabled but OZY_MAXMIND_DB is empty in enforce mode")
			}
			log.Printf("[FIREWALL_LOG] geofencing configured but OZY_MAXMIND_DB missing; continuing in log-only mode")
			return engine, nil
		}
		db, openErr := maxminddb.Open(maxmindPath)
		if openErr != nil {
			if mode == firewallModeEnforce {
				return nil, fmt.Errorf("open maxmind db: %w", openErr)
			}
			log.Printf("[FIREWALL_LOG] could not open maxmind db (%v); continuing in log-only mode", openErr)
			return engine, nil
		}
		engine.maxmindDB = db
	}

	return engine, nil
}

func (f *firewallEngine) evaluate(c echo.Context) (decision string, reason string) {
	if f.mode == firewallModeOff {
		return "allow", "FIREWALL_OFF"
	}

	clientIP, remoteIP := f.extractClientIP(c.Request())
	path := c.Request().URL.Path

	if isBypassPath(path) || clientIP.IsLoopback() {
		return "allow", "BYPASS_INTERNAL"
	}

	if prefixContainsAddr(f.deniedNets, clientIP) {
		return f.resolveDecision("IP_BLOCKED", clientIP, remoteIP, "")
	}

	if blocked, allowed, err := f.dynamicIPDecision(c.Request().Context(), clientIP); err != nil {
		log.Printf("[FIREWALL_LOG] dynamic firewall evaluation failed: %v", err)
	} else {
		if blocked {
			return f.resolveDecision("IP_BLOCKED_DYNAMIC", clientIP, remoteIP, "")
		}
		if allowed {
			return "allow", "IP_ALLOWED_DYNAMIC"
		}
	}

	if prefixContainsAddr(f.allowedNets, clientIP) {
		return "allow", "IP_ALLOWED"
	}

	if len(f.allowedCountries) > 0 || len(f.blockedCountries) > 0 {
		country, err := f.lookupCountryCode(clientIP)
		if err != nil {
			return f.resolveDecision("GEO_DB_ERROR", clientIP, remoteIP, "")
		}

		if len(f.blockedCountries) > 0 {
			if _, blocked := f.blockedCountries[country]; blocked {
				return f.resolveDecision("COUNTRY_BLOCKED", clientIP, remoteIP, country)
			}
		}

		if len(f.allowedCountries) > 0 {
			if _, allowed := f.allowedCountries[country]; !allowed {
				return f.resolveDecision("COUNTRY_NOT_ALLOWED", clientIP, remoteIP, country)
			}
		}
	}

	return "allow", "DEFAULT_ALLOW"
}

func (f *firewallEngine) resolveDecision(reason string, clientIP netip.Addr, remoteIP netip.Addr, countryCode string) (decision string, outReason string) {
	f.recordBlockedAttempt(clientIP, countryCode, reason)
	if f.mode == firewallModeLogOnly {
		log.Printf("[FIREWALL_LOG] Request from %s (remote=%s) would be BLOCKED in enforce mode. reason=%s", clientIP.String(), remoteIP.String(), reason)
		return "allow", "LOG_ONLY"
	}
	return "block", reason
}

func (f *firewallEngine) recordBlockedAttempt(clientIP netip.Addr, countryCode, reason string) {
	if f == nil || f.metrics == nil {
		return
	}
	f.metrics.RecordBlock(clientIP.String(), countryCode, reason)
}

func (f *firewallEngine) extractClientIP(req *http.Request) (netip.Addr, netip.Addr) {
	remote := parseRemoteIP(req.RemoteAddr)
	if !remote.IsValid() {
		return netip.IPv4Unspecified(), netip.IPv4Unspecified()
	}

	if !f.shouldTrustForwarded(remote) {
		return remote, remote
	}

	xff := strings.TrimSpace(req.Header.Get("X-Forwarded-For"))
	if xff == "" {
		return remote, remote
	}

	for _, candidate := range strings.Split(xff, ",") {
		parsed, err := netip.ParseAddr(strings.TrimSpace(candidate))
		if err == nil {
			return parsed.Unmap(), remote
		}
	}

	return remote, remote
}

func (f *firewallEngine) shouldTrustForwarded(remote netip.Addr) bool {
	if len(f.trustedProxies) == 0 {
		return false
	}
	return prefixContainsAddr(f.trustedProxies, remote)
}

func (f *firewallEngine) lookupCountryCode(ip netip.Addr) (string, error) {
	if f.geoLookupOverride != nil {
		country, err := f.geoLookupOverride(ip)
		if err != nil {
			return "", err
		}
		country = strings.ToUpper(strings.TrimSpace(country))
		if country == "" {
			return "", errors.New("empty country code")
		}
		return country, nil
	}

	if f.maxmindDB == nil {
		return "", errors.New("maxmind db unavailable")
	}

	type countryRecord struct {
		Country struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
		RegisteredCountry struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"registered_country"`
	}

	var record countryRecord
	if err := f.maxmindDB.Lookup(ip.AsSlice(), &record); err != nil {
		return "", err
	}

	country := strings.ToUpper(strings.TrimSpace(record.Country.ISOCode))
	if country == "" {
		country = strings.ToUpper(strings.TrimSpace(record.RegisteredCountry.ISOCode))
	}
	if country == "" {
		return "", errors.New("country not found")
	}
	return country, nil
}

func (f *firewallEngine) dynamicIPDecision(ctx context.Context, ip netip.Addr) (blocked bool, allowed bool, err error) {
	if f.dynamicRuleStore == nil {
		return false, false, nil
	}

	blockedNets, allowedNets, loadErr := f.getDynamicRules(ctx)
	if loadErr != nil {
		return false, false, loadErr
	}

	if prefixContainsAddr(blockedNets, ip) {
		return true, false, nil
	}
	if prefixContainsAddr(allowedNets, ip) {
		return false, true, nil
	}
	return false, false, nil
}

func (f *firewallEngine) getDynamicRules(ctx context.Context) ([]netip.Prefix, []netip.Prefix, error) {
	now := time.Now()
	f.dynamicRulesMu.RLock()
	loadedAt := f.dynamicRulesLoadedAt
	blocked := append([]netip.Prefix(nil), f.dynamicBlockedNets...)
	allowed := append([]netip.Prefix(nil), f.dynamicAllowedNets...)
	f.dynamicRulesMu.RUnlock()

	if !loadedAt.IsZero() && now.Sub(loadedAt) <= f.dynamicRuleCacheTTL {
		return blocked, allowed, nil
	}

	f.dynamicRulesMu.Lock()
	defer f.dynamicRulesMu.Unlock()
	if !f.dynamicRulesLoadedAt.IsZero() && now.Sub(f.dynamicRulesLoadedAt) <= f.dynamicRuleCacheTTL {
		return append([]netip.Prefix(nil), f.dynamicBlockedNets...), append([]netip.Prefix(nil), f.dynamicAllowedNets...), nil
	}

	reloadCtx := ctx
	if reloadCtx == nil {
		reloadCtx = context.Background()
	}
	reloadCtx, cancel := context.WithTimeout(reloadCtx, 500*time.Millisecond)
	defer cancel()

	rules, err := f.dynamicRuleStore.LoadActiveIPRules(reloadCtx)
	if err != nil {
		if !f.dynamicRulesLoadedAt.IsZero() {
			// Keep using last known-good cache on transient DB failures.
			f.dynamicRulesLoadedAt = time.Now().Add(-f.dynamicRuleCacheTTL + f.dynamicRefreshBackoff)
			return append([]netip.Prefix(nil), f.dynamicBlockedNets...), append([]netip.Prefix(nil), f.dynamicAllowedNets...), nil
		}
		return nil, nil, err
	}

	nextBlocked, nextAllowed := compileDynamicRules(rules)
	f.dynamicBlockedNets = nextBlocked
	f.dynamicAllowedNets = nextAllowed
	f.dynamicRulesLoadedAt = time.Now()

	return append([]netip.Prefix(nil), nextBlocked...), append([]netip.Prefix(nil), nextAllowed...), nil
}

func compileDynamicRules(rules []firewallIPRule) (blocked []netip.Prefix, allowed []netip.Prefix) {
	blocked = make([]netip.Prefix, 0, len(rules))
	allowed = make([]netip.Prefix, 0, len(rules))
	for _, rule := range rules {
		prefix, ok := parseIPOrCIDR(rule.IPAddress)
		if !ok {
			log.Printf("[FIREWALL_LOG] skipping invalid dynamic rule IP/CIDR=%q", rule.IPAddress)
			continue
		}
		switch strings.ToUpper(strings.TrimSpace(rule.RuleType)) {
		case "BLOCK", "DENY":
			blocked = append(blocked, prefix)
		case "ALLOW":
			allowed = append(allowed, prefix)
		default:
			log.Printf("[FIREWALL_LOG] skipping invalid dynamic rule type=%q", rule.RuleType)
		}
	}
	return blocked, allowed
}

func parseIPOrCIDR(raw string) (netip.Prefix, bool) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return netip.Prefix{}, false
	}
	if strings.Contains(value, "/") {
		prefix, err := netip.ParsePrefix(value)
		if err != nil {
			return netip.Prefix{}, false
		}
		return prefix.Masked(), true
	}
	addr, err := netip.ParseAddr(value)
	if err != nil {
		return netip.Prefix{}, false
	}
	bits := 128
	if addr.Is4() {
		bits = 32
	}
	return netip.PrefixFrom(addr.Unmap(), bits), true
}

func parseFirewallMode(raw string) firewallMode {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "", "off", "disabled", "false":
		return firewallModeOff
	case "log-only", "log", "dry-run", "dryrun":
		return firewallModeLogOnly
	default:
		return firewallModeEnforce
	}
}

func parsePrefixesFromCSV(raw string) ([]netip.Prefix, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	out := make([]netip.Prefix, 0, len(parts))
	for _, p := range parts {
		candidate := strings.TrimSpace(p)
		if candidate == "" {
			continue
		}
		if strings.Contains(candidate, "/") {
			prefix, err := netip.ParsePrefix(candidate)
			if err != nil {
				return nil, fmt.Errorf("invalid cidr %q: %w", candidate, err)
			}
			out = append(out, prefix.Masked())
			continue
		}
		addr, err := netip.ParseAddr(candidate)
		if err != nil {
			return nil, fmt.Errorf("invalid ip %q: %w", candidate, err)
		}
		bits := 128
		if addr.Is4() {
			bits = 32
		}
		out = append(out, netip.PrefixFrom(addr.Unmap(), bits))
	}
	return out, nil
}

func parseCountrySet(raw string) map[string]struct{} {
	out := map[string]struct{}{}
	for _, item := range strings.Split(raw, ",") {
		value := strings.ToUpper(strings.TrimSpace(item))
		if value == "" {
			continue
		}
		out[value] = struct{}{}
	}
	return out
}

func prefixContainsAddr(prefixes []netip.Prefix, addr netip.Addr) bool {
	if !addr.IsValid() {
		return false
	}
	needle := addr.Unmap()
	for _, prefix := range prefixes {
		if prefix.Contains(needle) {
			return true
		}
	}
	return false
}

func parseRemoteIP(remoteAddr string) netip.Addr {
	trimmed := strings.TrimSpace(remoteAddr)
	if trimmed == "" {
		return netip.IPv4Unspecified()
	}

	host, _, err := net.SplitHostPort(trimmed)
	if err == nil {
		if ip, parseErr := netip.ParseAddr(strings.TrimSpace(host)); parseErr == nil {
			return ip.Unmap()
		}
	}

	if ip, parseErr := netip.ParseAddr(trimmed); parseErr == nil {
		return ip.Unmap()
	}

	return netip.IPv4Unspecified()
}

func isBypassPath(path string) bool {
	switch strings.TrimSpace(path) {
	case "/api/health", "/api/project/health":
		return true
	default:
		return false
	}
}

func parseBoolDefault(raw string, fallback bool) bool {
	trimmed := strings.TrimSpace(strings.ToLower(raw))
	if trimmed == "" {
		return fallback
	}
	return trimmed == "1" || trimmed == "true" || trimmed == "yes" || trimmed == "on"
}

func parseIntDefault(raw string, fallback int) int {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}
	var value int
	if _, err := fmt.Sscanf(trimmed, "%d", &value); err != nil {
		return fallback
	}
	if value <= 0 {
		return fallback
	}
	return value
}

func firewallFirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func newSecurityMetricsCollectorFromEnv(db *data.DB) *securityMetricsCollector {
	storageRaw := strings.ToLower(strings.TrimSpace(os.Getenv("OZY_SECURITY_METRICS_STORAGE")))
	storage := securityMetricsStoragePostgres
	if storageRaw == string(securityMetricsStorageMemory) {
		storage = securityMetricsStorageMemory
	}
	if db == nil || db.Pool == nil {
		storage = securityMetricsStorageMemory
	}

	flushSeconds := parseIntDefault(strings.TrimSpace(os.Getenv("OZY_SECURITY_METRICS_FLUSH_SECONDS")), 300)
	flushThreshold := int64(parseIntDefault(strings.TrimSpace(os.Getenv("OZY_SECURITY_METRICS_FLUSH_THRESHOLD")), 500))

	return &securityMetricsCollector{
		storage:        storage,
		db:             db,
		flushInterval:  time.Duration(flushSeconds) * time.Second,
		flushThreshold: flushThreshold,
	}
}

func (c *securityMetricsCollector) Start(ctx context.Context) {
	if c == nil || c.storage != securityMetricsStoragePostgres {
		return
	}
	go func() {
		ticker := time.NewTicker(c.flushInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				_ = c.flushNow(context.Background())
			}
		}
	}()
}

func (c *securityMetricsCollector) RecordBlock(ip, countryCode, reason string) {
	if c == nil {
		return
	}
	ip = strings.TrimSpace(ip)
	countryCode = strings.ToUpper(strings.TrimSpace(countryCode))
	reason = strings.ToUpper(strings.TrimSpace(reason))
	if reason == "" {
		reason = "UNKNOWN"
	}

	key := securityMetricKey{
		BucketStart: time.Now().UTC().Truncate(time.Hour),
		SourceIP:    ip,
		CountryCode: countryCode,
		Reason:      reason,
	}

	entryAny, _ := c.entries.LoadOrStore(key, &atomic.Int64{})
	entry := entryAny.(*atomic.Int64)
	entry.Add(1)
	pending := c.pending.Add(1)

	if c.storage == securityMetricsStoragePostgres && c.flushThreshold > 0 && pending >= c.flushThreshold {
		go func() {
			_ = c.flushNow(context.Background())
		}()
	}
}

func (c *securityMetricsCollector) flushNow(ctx context.Context) error {
	if c == nil || c.storage != securityMetricsStoragePostgres || c.db == nil || c.db.Pool == nil {
		return nil
	}
	if !c.flushing.CompareAndSwap(false, true) {
		return nil
	}
	defer c.flushing.Store(false)

	type metricRow struct {
		key   securityMetricKey
		count int64
	}
	rows := make([]metricRow, 0, 128)
	var flushed int64

	c.entries.Range(func(key any, value any) bool {
		counter, ok := value.(*atomic.Int64)
		if !ok {
			return true
		}
		count := counter.Swap(0)
		if count <= 0 {
			return true
		}
		metricKey, ok := key.(securityMetricKey)
		if !ok {
			return true
		}
		rows = append(rows, metricRow{key: metricKey, count: count})
		flushed += count
		return true
	})

	if len(rows) == 0 {
		return nil
	}

	tx, err := c.db.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, row := range rows {
		if _, execErr := tx.Exec(ctx, `
			INSERT INTO _v_security_stats (bucket_start, source_ip, country_code, reason, blocked_count, updated_at)
			VALUES ($1, $2, $3, $4, $5, NOW())
			ON CONFLICT (bucket_start, source_ip, country_code, reason)
			DO UPDATE SET blocked_count = _v_security_stats.blocked_count + EXCLUDED.blocked_count, updated_at = NOW()
		`, row.key.BucketStart, row.key.SourceIP, row.key.CountryCode, row.key.Reason, row.count); execErr != nil {
			return execErr
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return err
	}

	c.pending.Add(-flushed)
	c.lastFlushUnix.Store(time.Now().Unix())
	return nil
}

func (c *securityMetricsCollector) Snapshot(ctx context.Context, windowHours int) (firewallMetricsResponse, error) {
	if c == nil {
		return firewallMetricsResponse{Storage: string(securityMetricsStorageMemory), WindowHours: 24}, nil
	}
	if windowHours <= 0 {
		windowHours = 24
	}
	if windowHours > 168 {
		windowHours = 168
	}

	cutoff := time.Now().UTC().Add(-time.Duration(windowHours) * time.Hour)
	reasonCounts := map[string]int64{}
	countryCounts := map[string]int64{}
	ipCounts := map[string]int64{}

	// Include unflushed in-memory counters first.
	c.entries.Range(func(key any, value any) bool {
		metricKey, ok := key.(securityMetricKey)
		if !ok || metricKey.BucketStart.Before(cutoff) {
			return true
		}
		counter, ok := value.(*atomic.Int64)
		if !ok {
			return true
		}
		count := counter.Load()
		if count <= 0 {
			return true
		}
		reason := metricKey.Reason
		country := metricKey.CountryCode
		ip := metricKey.SourceIP
		if reason == "" {
			reason = "UNKNOWN"
		}
		if country == "" {
			country = "UNKNOWN"
		}
		if ip == "" {
			ip = "UNKNOWN"
		}
		reasonCounts[reason] += count
		countryCounts[country] += count
		ipCounts[ip] += count
		return true
	})

	if c.storage == securityMetricsStoragePostgres && c.db != nil && c.db.Pool != nil {
		rows, err := c.db.Pool.Query(ctx, `
			SELECT source_ip, country_code, reason, blocked_count
			FROM _v_security_stats
			WHERE bucket_start >= $1
		`, cutoff)
		if err != nil {
			return firewallMetricsResponse{}, err
		}
		defer rows.Close()

		for rows.Next() {
			var sourceIP, countryCode, reason string
			var blockedCount int64
			if scanErr := rows.Scan(&sourceIP, &countryCode, &reason, &blockedCount); scanErr != nil {
				return firewallMetricsResponse{}, scanErr
			}
			if blockedCount <= 0 {
				continue
			}
			reason = strings.ToUpper(strings.TrimSpace(reason))
			countryCode = strings.ToUpper(strings.TrimSpace(countryCode))
			sourceIP = strings.TrimSpace(sourceIP)
			if reason == "" {
				reason = "UNKNOWN"
			}
			if countryCode == "" {
				countryCode = "UNKNOWN"
			}
			if sourceIP == "" {
				sourceIP = "UNKNOWN"
			}
			reasonCounts[reason] += blockedCount
			countryCounts[countryCode] += blockedCount
			ipCounts[sourceIP] += blockedCount
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			return firewallMetricsResponse{}, rowsErr
		}
	}

	response := firewallMetricsResponse{
		Storage:      string(c.storage),
		WindowHours:  windowHours,
		ByReason:     toSortedMetricRows(reasonCounts, 20),
		TopCountries: toSortedMetricRows(countryCounts, 5),
		TopIPs:       toSortedMetricRows(ipCounts, 5),
		Pending:      c.pending.Load(),
	}
	for _, row := range response.ByReason {
		response.TotalBlocked += row.Count
	}
	if last := c.lastFlushUnix.Load(); last > 0 {
		t := time.Unix(last, 0).UTC()
		response.LastFlushAt = &t
	}

	return response, nil
}

func toSortedMetricRows(values map[string]int64, limit int) []firewallMetricsRow {
	rows := make([]firewallMetricsRow, 0, len(values))
	for label, count := range values {
		if count <= 0 {
			continue
		}
		rows = append(rows, firewallMetricsRow{Label: label, Count: count})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Count == rows[j].Count {
			return rows[i].Label < rows[j].Label
		}
		return rows[i].Count > rows[j].Count
	})
	if limit > 0 && len(rows) > limit {
		return rows[:limit]
	}
	return rows
}

func (s *firewallDBRuleStore) LoadActiveIPRules(ctx context.Context) ([]firewallIPRule, error) {
	if s == nil || s.db == nil || s.db.Pool == nil {
		return nil, nil
	}
	rows, err := s.db.Pool.Query(ctx, `
		SELECT ip_address, rule_type
		FROM _v_ip_rules
		WHERE expires_at IS NULL OR expires_at > NOW()
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rules := make([]firewallIPRule, 0)
	for rows.Next() {
		var rule firewallIPRule
		if scanErr := rows.Scan(&rule.IPAddress, &rule.RuleType); scanErr != nil {
			return nil, scanErr
		}
		rules = append(rules, rule)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, rowsErr
	}
	return rules, nil
}

func (f *firewallEngine) invalidateDynamicRulesCache() {
	if f == nil {
		return
	}
	f.dynamicRulesMu.Lock()
	defer f.dynamicRulesMu.Unlock()
	f.dynamicRulesLoadedAt = time.Time{}
}

func (h *Handler) invalidateFirewallCache() {
	if h == nil || h.firewallEngine == nil {
		return
	}
	h.firewallEngine.invalidateDynamicRulesCache()
}

// --- API Handlers for Managing Rules ---

func (h *Handler) ListIPRules(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	rows, err := h.DB.Pool.Query(ctx, "SELECT id, ip_address, rule_type, reason, expires_at, created_at FROM _v_ip_rules ORDER BY created_at DESC")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	defer rows.Close()

	var rules []IPRule
	for rows.Next() {
		var r IPRule
		if err := rows.Scan(&r.ID, &r.IPAddress, &r.RuleType, &r.Reason, &r.ExpiresAt, &r.CreatedAt); err != nil {
			continue
		}
		rules = append(rules, r)
	}

	if err := rows.Err(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusOK, rules)
}

func (h *Handler) CreateIPRule(c echo.Context) error {
	var req struct {
		IPAddress string `json:"ip_address"`
		RuleType  string `json:"rule_type"` // ALLOW or BLOCK
		Reason    string `json:"reason"`
		Duration  int    `json:"duration_hours,omitempty"` // 0 = permanent
	}
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	if _, ok := parseIPOrCIDR(req.IPAddress); !ok {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "ip_address must be a valid IP or CIDR"})
	}
	req.RuleType = strings.ToUpper(strings.TrimSpace(req.RuleType))
	if req.RuleType != "ALLOW" && req.RuleType != "BLOCK" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "rule_type must be ALLOW or BLOCK"})
	}

	var expiresAt *time.Time
	if req.Duration > 0 {
		t := time.Now().Add(time.Duration(req.Duration) * time.Hour)
		expiresAt = &t
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, `
		INSERT INTO _v_ip_rules (ip_address, rule_type, reason, expires_at, created_by)
		VALUES ($1, $2, $3, $4, 'admin')
		ON CONFLICT (ip_address) DO UPDATE
		SET rule_type = $2, reason = $3, expires_at = $4
	`, req.IPAddress, req.RuleType, req.Reason, expiresAt)

	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	h.invalidateFirewallCache()

	return c.JSON(http.StatusCreated, map[string]string{"status": "rule_applied"})
}

func (h *Handler) DeleteIPRule(c echo.Context) error {
	id := c.Param("id")
	ctx, cancel := context.WithTimeout(c.Request().Context(), 5*time.Second)
	defer cancel()

	_, err := h.DB.Pool.Exec(ctx, "DELETE FROM _v_ip_rules WHERE id = $1", id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	h.invalidateFirewallCache()
	return c.NoContent(http.StatusOK)
}
