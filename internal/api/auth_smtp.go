package api

import (
	"log"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/Xangel0s/OzyBase/internal/mailer"
	"github.com/labstack/echo/v4"
)

type SMTPSettingsResponse struct {
	Host               string `json:"host"`
	Port               string `json:"port"`
	Username           string `json:"username"`
	From               string `json:"from"`
	Configured         bool   `json:"configured"`
	PasswordConfigured bool   `json:"password_configured"`
	Source             string `json:"source"`
}

type smtpSettingsRequest struct {
	Host             string `json:"host"`
	Port             string `json:"port"`
	Username         string `json:"username"`
	Password         string `json:"password"`
	From             string `json:"from"`
	PreservePassword bool   `json:"preserve_password"`
	ClearPassword    bool   `json:"clear_password"`
}

type smtpTestRequest struct {
	To                string `json:"to"`
	Subject           string `json:"subject"`
	Host              string `json:"host"`
	Port              string `json:"port"`
	Username          string `json:"username"`
	Password          string `json:"password"`
	From              string `json:"from"`
	UseStoredPassword bool   `json:"use_stored_password"`
	ClearPassword     bool   `json:"clear_password"`
}

func (h *Handler) GetSMTPSettings(c echo.Context) error {
	settings, err := h.readSMTPSettings(c)
	if err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "auth.smtp.read", err, "Unable to load SMTP settings right now.")
	}
	return c.JSON(http.StatusOK, settings)
}

func (h *Handler) UpdateSMTPSettings(c echo.Context) error {
	var req smtpSettingsRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, publicErrorPayload("Invalid SMTP configuration payload.", "BAD_REQUEST"))
	}

	cfg := mailer.SMTPConfig{
		Host:     req.Host,
		Port:     req.Port,
		Username: req.Username,
		Password: req.Password,
		From:     req.From,
	}
	if err := mailer.SaveSMTPConfig(c.Request().Context(), h.DB, cfg, req.PreservePassword, req.ClearPassword); err != nil {
		if isSMTPValidationError(err) {
			return c.JSON(http.StatusBadRequest, publicErrorPayload(err.Error(), "SMTP_INVALID_CONFIGURATION"))
		}
		return internalAPIError(c, http.StatusInternalServerError, "auth.smtp.update", err, "Unable to save SMTP settings right now.")
	}

	h.invalidateProjectInfoCache()

	settings, err := h.readSMTPSettings(c)
	if err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "auth.smtp.read_after_update", err, "SMTP settings were saved, but the refreshed state could not be loaded.")
	}
	return c.JSON(http.StatusOK, settings)
}

func (h *Handler) SendSMTPTestEmail(c echo.Context) error {
	var req smtpTestRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, publicErrorPayload("Invalid SMTP test payload.", "BAD_REQUEST"))
	}

	to := strings.TrimSpace(req.To)
	if to == "" {
		return c.JSON(http.StatusBadRequest, publicErrorPayload("Test recipient email is required.", "SMTP_TEST_RECIPIENT_REQUIRED"))
	}
	if _, err := mail.ParseAddress(to); err != nil {
		return c.JSON(http.StatusBadRequest, publicErrorPayload("Test recipient email is invalid.", "SMTP_TEST_RECIPIENT_INVALID"))
	}

	currentCfg, _, err := mailer.LoadSMTPConfig(c.Request().Context(), h.DB, mailer.SMTPConfigFromEnvironment())
	if err != nil {
		return internalAPIError(c, http.StatusInternalServerError, "auth.smtp.resolve_test_base", err, "Unable to load the current SMTP settings right now.")
	}

	testCfg := mailer.SMTPConfig{
		Host:     req.Host,
		Port:     req.Port,
		Username: req.Username,
		Password: req.Password,
		From:     req.From,
	}
	if strings.TrimSpace(testCfg.Host) == "" {
		testCfg.Host = currentCfg.Host
	}
	if strings.TrimSpace(testCfg.Port) == "" {
		testCfg.Port = currentCfg.Port
	}
	if strings.TrimSpace(testCfg.Username) == "" {
		testCfg.Username = currentCfg.Username
	}
	if strings.TrimSpace(testCfg.From) == "" {
		testCfg.From = currentCfg.From
	}
	switch {
	case req.ClearPassword:
		testCfg.Password = ""
	case req.UseStoredPassword && strings.TrimSpace(req.Password) == "":
		testCfg.Password = currentCfg.Password
	}

	if !currentCfg.Configured() && !testCfg.Configured() {
		return c.JSON(http.StatusConflict, publicErrorPayload(
			"SMTP is not configured yet. Save a real mail server first, then run the delivery test.",
			"SMTP_NOT_CONFIGURED",
		))
	}

	if err := testCfg.Validate(); err != nil {
		return c.JSON(http.StatusBadRequest, publicErrorPayload(err.Error(), "SMTP_INVALID_CONFIGURATION"))
	}

	subject := strings.TrimSpace(req.Subject)
	if subject == "" {
		subject = "OzyBase SMTP test"
	}
	body := strings.Join([]string{
		"This is a transactional email test from OzyBase.",
		"",
		"If you received this message, the configured SMTP transport is working.",
		"Generated at: " + time.Now().UTC().Format(time.RFC3339),
		"Request ID: " + RequestIDFromContext(c),
	}, "\n")

	sender := mailer.NewSMTPMailer(testCfg.Host, testCfg.Port, testCfg.Username, testCfg.Password, testCfg.From)
	if err := sender.Send(to, subject, body); err != nil {
		log.Printf("request_id=%s operation=auth.smtp.test error=%v", RequestIDFromContext(c), err)
		return c.JSON(http.StatusBadGateway, publicErrorPayload("Unable to deliver the test email with the current SMTP settings.", "SMTP_TEST_FAILED"))
	}

	return c.JSON(http.StatusOK, map[string]any{
		"status":      "sent",
		"to":          to,
		"from":        testCfg.From,
		"smtp_source": "draft",
	})
}

func (h *Handler) readSMTPSettings(c echo.Context) (SMTPSettingsResponse, error) {
	cfg, source, err := mailer.LoadSMTPConfig(c.Request().Context(), h.DB, mailer.SMTPConfigFromEnvironment())
	if err != nil {
		return SMTPSettingsResponse{}, err
	}
	return SMTPSettingsResponse{
		Host:               cfg.Host,
		Port:               cfg.Port,
		Username:           cfg.Username,
		From:               cfg.From,
		Configured:         cfg.Configured(),
		PasswordConfigured: strings.TrimSpace(cfg.Password) != "",
		Source:             string(source),
	}, nil
}

func isSMTPValidationError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(strings.TrimSpace(err.Error()))
	return strings.Contains(message, "smtp host is required") ||
		strings.Contains(message, "smtp port is required") ||
		strings.Contains(message, "smtp port must be between 1 and 65535") ||
		strings.Contains(message, "from address is required") ||
		strings.Contains(message, "from address is invalid")
}
