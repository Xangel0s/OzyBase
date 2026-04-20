package api

import (
	"log"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

func publicErrorPayload(message, errorCode string) map[string]any {
	payload := map[string]any{
		"error":            strings.TrimSpace(message),
		publicErrorFlagKey: true,
	}
	if strings.TrimSpace(errorCode) != "" {
		payload["error_code"] = strings.TrimSpace(errorCode)
	}
	return payload
}

func internalAPIError(c echo.Context, status int, operation string, err error, publicMessage string) error {
	if status < http.StatusInternalServerError {
		status = http.StatusInternalServerError
	}

	requestID := RequestIDFromContext(c)
	log.Printf("request_id=%s operation=%s error=%v", requestID, strings.TrimSpace(operation), err)

	message := strings.TrimSpace(publicMessage)
	if message == "" {
		message = http.StatusText(http.StatusInternalServerError)
	}

	return c.JSON(status, publicErrorPayload(message, inferErrorCode(status)))
}
