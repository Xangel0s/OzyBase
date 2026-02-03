package logger

import (
	"os"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// Log is the global logger instance
var Log zerolog.Logger

// Init initializes the global logger
func Init(debug bool) {
	zerolog.TimeFieldFormat = time.RFC3339

	// Default level is info
	level := zerolog.InfoLevel
	if debug {
		level = zerolog.DebugLevel
	}
	zerolog.SetGlobalLevel(level)

	// In development, use a pretty console logger
	// In production, use JSON output for observability
	if os.Getenv("ENV") != "production" {
		Log = log.Output(zerolog.ConsoleWriter{
			Out:        os.Stdout,
			TimeFormat: "15:04:05",
		})
	} else {
		Log = zerolog.New(os.Stdout).With().Timestamp().Logger()
	}
}
