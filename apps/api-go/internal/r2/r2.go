package r2

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"github.com/m0r4a/Voidbinder/apps/api-go/internal/voidbinder"
)

const listPageSize = 1000

type Config struct {
	Endpoint        string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
}

type BlobStore struct {
	client *minio.Client
	bucket string
}

func New(cfg Config) (*BlobStore, error) {
	u, err := url.Parse(cfg.Endpoint)
	if err != nil {
		return nil, fmt.Errorf("parse endpoint: %w", err)
	}
	client, err := minio.New(u.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure: u.Scheme != "http",
		Region: "auto",
	})
	if err != nil {
		return nil, fmt.Errorf("create client: %w", err)
	}
	return &BlobStore{client: client, bucket: cfg.Bucket}, nil
}

func quoteETag(etag string) string {
	if strings.HasPrefix(etag, `"`) {
		return etag
	}
	return `"` + etag + `"`
}

func blobInfo(o minio.ObjectInfo) voidbinder.BlobInfo {
	return voidbinder.BlobInfo{
		Key:          o.Key,
		Size:         o.Size,
		ETag:         quoteETag(o.ETag),
		Uploaded:     o.LastModified,
		ContentType:  o.ContentType,
		CacheControl: o.Metadata.Get("Cache-Control"),
	}
}

func isNotFound(err error) bool {
	return minio.ToErrorResponse(err).Code == minio.NoSuchKey
}

func (s *BlobStore) Put(ctx context.Context, key string, body io.Reader, size int64, opts voidbinder.BlobPutOptions) (voidbinder.BlobInfo, error) {
	if _, err := s.client.PutObject(ctx, s.bucket, key, body, size, minio.PutObjectOptions{
		ContentType:  opts.ContentType,
		CacheControl: opts.CacheControl,
	}); err != nil {
		return voidbinder.BlobInfo{}, fmt.Errorf("put %s: %w", key, err)
	}
	o, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return voidbinder.BlobInfo{}, fmt.Errorf("stat %s: %w", key, err)
	}
	return blobInfo(o), nil
}

func (s *BlobStore) Get(ctx context.Context, key string) (*voidbinder.StoredBlob, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("get %s: %w", key, err)
	}
	o, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		if isNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("get %s: %w", key, err)
	}
	return &voidbinder.StoredBlob{BlobInfo: blobInfo(o), Body: obj}, nil
}

func (s *BlobStore) Head(ctx context.Context, key string) (*voidbinder.BlobInfo, error) {
	o, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if isNotFound(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("head %s: %w", key, err)
	}
	info := blobInfo(o)
	return &info, nil
}

func (s *BlobStore) Delete(ctx context.Context, key string) error {
	if err := s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("delete %s: %w", key, err)
	}
	return nil
}

func (s *BlobStore) List(ctx context.Context, prefix, cursor string) (voidbinder.BlobList, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var list voidbinder.BlobList
	for o := range s.client.ListObjects(ctx, s.bucket, minio.ListObjectsOptions{
		Prefix:       prefix,
		Recursive:    true,
		StartAfter:   cursor,
		MaxKeys:      listPageSize,
		WithMetadata: true,
	}) {
		if o.Err != nil {
			return voidbinder.BlobList{}, fmt.Errorf("list %s: %w", prefix, o.Err)
		}
		if len(list.Objects) == listPageSize {
			list.Cursor = list.Objects[listPageSize-1].Key
			break
		}
		list.Objects = append(list.Objects, blobInfo(o))
	}
	return list, nil
}
