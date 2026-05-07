package logger

import (
	"fmt"
	stdlog "log"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
	zlog "github.com/rs/zerolog/log"
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

	base := zerolog.New(os.Stdout).With().Timestamp().Str("service", "ozybase").Logger()
	format := strings.ToLower(strings.TrimSpace(os.Getenv("OZY_LOG_FORMAT")))
	if format == "" {
		if debug {
			format = "console"
		} else {
			format = "json"
		}
	}

	if format == "console" {
		base = base.Output(zerolog.ConsoleWriter{
			Out:        os.Stdout,
			TimeFormat: time.DateTime,
			NoColor:    false,
			FormatLevel: func(i interface{}) string {
				if i == nil {
					return "LOG  "
				}
				return strings.ToUpper(fmt.Sprintf("%-5s", i))
			},
		})
	}

	Log = base
	zlog.Logger = Log

	// Route standard library logs through zerolog so legacy log.Println callers stay structured.
	stdlog.SetFlags(0)
	stdlog.SetOutput(Log)
}
