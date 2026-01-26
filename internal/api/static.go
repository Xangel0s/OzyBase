package api

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// DistFS is the embedded frontend dist directory
//
//go:embed all:frontend_dist
var distEmbedFS embed.FS

// RegisterStaticRoutes registers the routes for serving the embedded frontend
func RegisterStaticRoutes(e *echo.Echo) {
	// Root of the embedded FS is 'frontend_dist'
	distFS, err := fs.Sub(distEmbedFS, "frontend_dist")
	if err != nil {
		panic(err)
	}

	// Create a file server handler
	fileServer := http.FileServer(http.FS(distFS))

	// Serve static files
	e.GET("/*", func(c echo.Context) error {
		path := c.Request().URL.Path

		// If it's an API request, let Echo handle it (though usually API routes are registered first)
		if strings.HasPrefix(path, "/api") {
			return echo.ErrNotFound
		}

		// Check if file exists in embedded FS
		_, err := distFS.Open(strings.TrimPrefix(path, "/"))
		if err != nil {
			// If file not found, serve index.html (SPA Fallback)
			c.Request().URL.Path = "/"
			fileServer.ServeHTTP(c.Response(), c.Request())
			return nil
		}

		// Otherwise serve the file
		fileServer.ServeHTTP(c.Response(), c.Request())
		return nil
	})
}
