package api

import (
	"context"
	"crypto/rand"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"time"
)

const corsAllowMethods = "GET,HEAD,PUT,POST,DELETE,PATCH"

var (
	requestIDPattern = regexp.MustCompile(`^[\w\-=]{1,255}$`)

	securityHeaders = [][2]string{
		{"Cross-Origin-Resource-Policy", "same-origin"},
		{"Cross-Origin-Opener-Policy", "same-origin"},
		{"Origin-Agent-Cluster", "?1"},
		{"Referrer-Policy", "no-referrer"},
		{"Strict-Transport-Security", "max-age=15552000; includeSubDomains"},
		{"X-Content-Type-Options", "nosniff"},
		{"X-DNS-Prefetch-Control", "off"},
		{"X-Download-Options", "noopen"},
		{"X-Frame-Options", "SAMEORIGIN"},
		{"X-Permitted-Cross-Domain-Policies", "none"},
		{"X-XSS-Protection", "0"},
	}
)

type requestIDKey struct{}

func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

func newRequestID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.status != 0 {
		return
	}
	r.status = status
	if r.Header().Get("Cache-Control") == "" {
		r.Header().Set("Cache-Control", "no-store")
	}
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if r.status == 0 {
		r.WriteHeader(http.StatusOK)
	}
	return r.ResponseWriter.Write(b)
}

func (r *statusRecorder) Unwrap() http.ResponseWriter {
	return r.ResponseWriter
}

func (s *Server) applyCORS(w http.ResponseWriter, r *http.Request) bool {
	h := w.Header()
	h.Add("Vary", "Origin")
	origin := r.Header.Get("Origin")
	if origin == "" || !slices.Contains(s.origins, origin) {
		return false
	}
	h.Set("Access-Control-Allow-Origin", origin)
	h.Set("Access-Control-Allow-Credentials", "true")
	if r.Method != http.MethodOptions || r.Header.Get("Access-Control-Request-Method") == "" {
		return false
	}
	h.Set("Access-Control-Allow-Methods", corsAllowMethods)
	if headers := r.Header.Get("Access-Control-Request-Headers"); headers != "" {
		h.Set("Access-Control-Allow-Headers", headers)
		h.Add("Vary", "Access-Control-Request-Headers")
	}
	w.WriteHeader(http.StatusNoContent)
	return true
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	id := r.Header.Get("X-Request-Id")
	if !requestIDPattern.MatchString(id) {
		id = newRequestID()
	}
	r = r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id))
	rec := &statusRecorder{ResponseWriter: w}
	h := rec.Header()
	h.Set("X-Request-Id", id)
	for _, kv := range securityHeaders {
		h.Set(kv[0], kv[1])
	}

	defer func() {
		if p := recover(); p != nil {
			s.logger.LogAttrs(r.Context(), slog.LevelError, fmt.Sprint(p), slog.String("requestId", id))
			if rec.status == 0 {
				writeError(rec, r, http.StatusInternalServerError, "internal", "Internal server error", nil)
			}
		}
		s.logAccess(r, id, rec.status, time.Since(start))
	}()

	if s.applyCORS(rec, r) {
		return
	}
	s.mux.ServeHTTP(rec, r)
	if rec.status == 0 {
		rec.WriteHeader(http.StatusOK)
	}
}

func (s *Server) logAccess(r *http.Request, id string, status int, elapsed time.Duration) {
	level := slog.LevelInfo
	switch {
	case status >= http.StatusInternalServerError:
		level = slog.LevelError
	case status >= http.StatusBadRequest:
		level = slog.LevelWarn
	}
	s.logger.LogAttrs(r.Context(), level, "request",
		slog.String("requestId", id),
		slog.String("method", r.Method),
		slog.String("path", r.URL.Path),
		slog.Int("status", status),
		slog.Int64("ms", elapsed.Milliseconds()),
	)
}
