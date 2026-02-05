package api

import (
	"fmt"

	"github.com/labstack/echo/v4"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "ozy_http_requests_total",
			Help: "Total number of HTTP requests.",
		},
		[]string{"method", "path", "status"},
	)
	dbOperationsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "ozy_db_operations_total",
			Help: "Total number of database operations.",
		},
		[]string{"table", "operation"},
	)
)

func init() {
	prometheus.MustRegister(httpRequestsTotal)
	prometheus.MustRegister(dbOperationsTotal)
}

// PrometheusMiddleware collects metrics for prometheus
func PrometheusMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			err := next(c)

			path := c.Path()
			if path == "" {
				path = "unknown"
			}

			httpRequestsTotal.WithLabelValues(
				c.Request().Method,
				path,
				fmt.Sprint(c.Response().Status),
			).Inc()

			return err
		}
	}
}

// RegisterPrometheus registers the /metrics endpoint
func RegisterPrometheus(e *echo.Echo) {
	e.GET("/metrics", echo.WrapHandler(promhttp.Handler()))
}
