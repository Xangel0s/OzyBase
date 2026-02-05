package main

import (
	"os"
)

func main() {
	path := "internal/api/handlers.go"
	b, _ := os.ReadFile(path)

	// Filter: only allow valid characters (ASCII + typical UTF8)
	// We'll just remove NUL (0x00) bytes.
	clean := make([]byte, 0, len(b))
	for _, v := range b {
		if v != 0x00 {
			clean = append(clean, v)
		}
	}

	os.WriteFile(path, clean, 0644)
}
