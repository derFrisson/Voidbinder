package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/m0r4a/Voidbinder/apps/api-go/internal/api"
	"github.com/m0r4a/Voidbinder/apps/api-go/internal/postgres"
	"github.com/m0r4a/Voidbinder/apps/api-go/internal/r2"
)

const (
	maxDBConns      = 10
	startupTimeout  = 10 * time.Second
	shutdownTimeout = 15 * time.Second
)

func main() {
	logger := api.NewLogger(os.Stdout)
	if err := run(logger); err != nil {
		logger.Error("api stopped", slog.String("error", err.Error()))
		os.Exit(1)
	}
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func run(logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	startCtx, cancel := context.WithTimeout(ctx, startupTimeout)
	pool, err := postgres.Open(startCtx, dbURL, maxDBConns)
	cancel()
	if err != nil {
		return err
	}
	defer pool.Close()

	platform := api.Platform{CardStore: postgres.NewCardStore(pool)}
	if endpoint := os.Getenv("R2_ENDPOINT"); endpoint != "" {
		blobs, err := r2.New(r2.Config{
			Endpoint:        endpoint,
			AccessKeyID:     os.Getenv("R2_ACCESS_KEY_ID"),
			SecretAccessKey: os.Getenv("R2_SECRET_ACCESS_KEY"),
			Bucket:          getenv("R2_BUCKET", "voidbinder-catalog"),
		})
		if err != nil {
			return fmt.Errorf("blob store: %w", err)
		}
		platform.BlobStore = blobs
	} else {
		logger.Warn("R2_ENDPOINT not set, blob store disabled")
	}

	srv := &http.Server{
		Addr: ":" + getenv("PORT", "8787"),
		Handler: api.New(api.Config{
			AppURL:   getenv("APP_URL", api.ExpoWebDevOrigin),
			Version:  getenv("VERSION", "local"),
			Platform: platform,
			Logger:   logger,
		}),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errc := make(chan error, 1)
	go func() {
		logger.Info("listening", slog.String("addr", srv.Addr))
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}
