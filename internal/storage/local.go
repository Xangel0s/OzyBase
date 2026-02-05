package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

type LocalProvider struct {
	basePath string
}

func NewLocalProvider(basePath string) *LocalProvider {
	_ = os.MkdirAll(basePath, 0755)
	return &LocalProvider{basePath: basePath}
}

func (l *LocalProvider) Upload(ctx context.Context, bucket, key string, reader io.Reader, size int64, contentType string, acl ACL) error {
	path := filepath.Join(l.basePath, bucket, key)
	_ = os.MkdirAll(filepath.Dir(path), 0755)

	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	_, err = io.Copy(f, reader)
	return err
}

func (l *LocalProvider) Download(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	path := filepath.Join(l.basePath, bucket, key)
	return os.Open(path)
}

func (l *LocalProvider) Delete(ctx context.Context, bucket, key string) error {
	path := filepath.Join(l.basePath, bucket, key)
	return os.Remove(path)
}

func (l *LocalProvider) GetURL(ctx context.Context, bucket, key string) (string, error) {
	// Usually served by the app itself
	return fmt.Sprintf("/api/files/%s/%s", bucket, key), nil
}
