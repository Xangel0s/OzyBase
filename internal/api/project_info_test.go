package api

import (
	"encoding/json"
	"testing"
)

func TestProjectInfoDoesNotExposeConnectionSecrets(t *testing.T) {
	info := ProjectInfo{
		Name:     "test",
		Database: "ozybase",
		Version:  "16",
	}

	payload, err := json.Marshal(info)
	if err != nil {
		t.Fatalf("marshal project info: %v", err)
	}

	body := string(payload)
	for _, forbidden := range []string{
		`"host":`,
		`"port":`,
		`"user":`,
		`"password":`,
		`"service_role":`,
		`"service_key":`,
		`"pooler":`,
		`"smtp_pass":`,
	} {
		if contains(body, forbidden) {
			t.Fatalf("project info payload unexpectedly contains %s", forbidden)
		}
	}
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) && func() bool {
		for i := 0; i <= len(haystack)-len(needle); i++ {
			if haystack[i:i+len(needle)] == needle {
				return true
			}
		}
		return false
	}()
}
