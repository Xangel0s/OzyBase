package mailer

import (
	"strings"
	"testing"
)

func TestSMTPAuthForConfigRequiresCredentials(t *testing.T) {
	if got := smtpAuthForConfig("127.0.0.1", "", ""); got != nil {
		t.Fatalf("expected nil auth without credentials")
	}
}

func TestSMTPAuthForConfigAcceptsHostPort(t *testing.T) {
	if got := smtpAuthForConfig("smtp.example.com:587", "demo", "secret"); got == nil {
		t.Fatalf("expected smtp auth when host and credentials are present")
	}
}

func TestProjectInviteTemplateUsesProjectLanguage(t *testing.T) {
	logMailer := NewLogMailer()
	subject := "Invitation to join Alpha on OzyBase"
	body := "owner@example.com has invited you to collaborate on the project 'Alpha'.\n\nLog in to your dashboard to get started."

	if err := logMailer.Send("demo@example.com", subject, body); err != nil {
		t.Fatalf("unexpected send error: %v", err)
	}

	definition := defaultTemplateDefinitions["workspace_invite"]
	if strings.Contains(strings.ToLower(definition.Body), "workspace '") || strings.Contains(strings.ToLower(definition.Body), "workspace \"") {
		t.Fatalf("workspace invite template should use project wording")
	}
	if !strings.Contains(strings.ToLower(definition.Body), "project") {
		t.Fatalf("workspace invite template should mention project")
	}
}
