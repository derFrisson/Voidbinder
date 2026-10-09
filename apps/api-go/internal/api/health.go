package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/m0r4a/Voidbinder/apps/api-go/internal/voidbinder"
)

const pingTimeout = 5 * time.Second

type HealthResponse struct {
	Status  string `json:"status"`
	DB      string `json:"db"`
	Version string `json:"version"`
}

func (s *Server) handleHealth(version string, cards voidbinder.CardStore) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), pingTimeout)
		defer cancel()
		if err := cards.Ping(ctx); err != nil {
			s.logger.LogAttrs(r.Context(), slog.LevelError, "database ping failed",
				slog.String("requestId", RequestID(r.Context())),
				slog.String("error", err.Error()),
			)
			writeJSON(w, http.StatusServiceUnavailable, HealthResponse{Status: "degraded", DB: "error", Version: version})
			return
		}
		writeJSON(w, http.StatusOK, HealthResponse{Status: "ok", DB: "ok", Version: version})
	})
}
