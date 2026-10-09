package postgres

import (
	"context"
	"os"
	"testing"
)

func TestCardStorePing(t *testing.T) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		t.Skip("DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := Open(ctx, url, 2)
	if err != nil {
		t.Fatalf("Open() failed: %v", err)
	}
	defer pool.Close()
	if err := NewCardStore(pool).Ping(ctx); err != nil {
		t.Errorf("Ping() = %v, want nil", err)
	}
}
