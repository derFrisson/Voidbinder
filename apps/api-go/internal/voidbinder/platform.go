package voidbinder

import (
	"context"
	"io"
	"time"
)

type CardStore interface {
	Ping(ctx context.Context) error
}

type BlobPutOptions struct {
	ContentType  string
	CacheControl string
}

type BlobInfo struct {
	Key          string
	Size         int64
	ETag         string
	Uploaded     time.Time
	ContentType  string
	CacheControl string
}

type StoredBlob struct {
	BlobInfo
	Body io.ReadCloser
}

type BlobList struct {
	Objects []BlobInfo
	Cursor  string
}

type BlobStore interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, opts BlobPutOptions) (BlobInfo, error)
	Get(ctx context.Context, key string) (*StoredBlob, error)
	Head(ctx context.Context, key string) (*BlobInfo, error)
	Delete(ctx context.Context, key string) error
	List(ctx context.Context, prefix, cursor string) (BlobList, error)
}

type Job struct {
	Type    string
	Payload any
}

type JobQueue interface {
	Send(ctx context.Context, job Job) error
}

type Vector struct {
	ID     string
	Values []float32
}

type VectorMatch struct {
	ID    string
	Score float64
}

type VectorIndex interface {
	Upsert(ctx context.Context, vectors []Vector) error
	Query(ctx context.Context, values []float32, topK int) ([]VectorMatch, error)
}
