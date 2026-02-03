package mailer

import (
	"fmt"
	"log"
	"time"
)

// Mailer defines the interface for sending emails
type Mailer interface {
	Send(to, subject, body string) error
	SendVerificationEmail(to, token string) error
	SendPasswordResetEmail(to, token string) error
	SendSecurityAlert(to, alertType, details string) error
}

// LogMailer is a mock mailer that logs emails to the console
type LogMailer struct{}

func NewLogMailer() *LogMailer {
	return &LogMailer{}
}

func (m *LogMailer) Send(to, subject, body string) error {
	log.Printf("\n--- EMAIL SENT ---\nTo: %s\nSubject: %s\nBody: %s\n------------------\n", to, subject, body)
	return nil
}

func (m *LogMailer) SendVerificationEmail(to, token string) error {
	subject := "Verify your OzyBase Account"
	link := fmt.Sprintf("http://localhost:5342/verify-email?token=%s", token)
	body := fmt.Sprintf("Click here to verify your account: %s\nToken: %s", link, token)
	return m.Send(to, subject, body)
}

func (m *LogMailer) SendPasswordResetEmail(to, token string) error {
	subject := "Reset your OzyBase Password"
	link := fmt.Sprintf("http://localhost:5342/reset-password?token=%s", token)
	body := fmt.Sprintf("Click here to reset your password: %s\nToken: %s", link, token)
	return m.Send(to, subject, body)
}

func (m *LogMailer) SendSecurityAlert(to, alertType, details string) error {
	subject := fmt.Sprintf("⚠️ SECURITY ALERT: %s", alertType)
	body := fmt.Sprintf("A critical security event has been detected:\n\nType: %s\nDetails: %s\n\nDate: %s\nAction Required: Check your OzyBase Dashboard immediately.", alertType, details, time.Now().Format(time.RFC1123))
	return m.Send(to, subject, body)
}
