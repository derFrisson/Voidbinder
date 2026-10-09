package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/m0r4a/Voidbinder/apps/api-go/internal/voidbinder"
)

type fakeCardStore struct {
	err error
}

func (f fakeCardStore) Ping(context.Context) error {
	return f.err
}

func newTestServer(t *testing.T, pingErr error) (*Server, *bytes.Buffer) {
	t.Helper()
	var logs bytes.Buffer
	s := New(Config{
		AppURL:   "https://app.example.test",
		Version:  "test",
		Platform: Platform{CardStore: fakeCardStore{err: pingErr}},
		Logger:   NewLogger(&logs),
	})
	return s, &logs
}

func serve(h http.Handler, method, target string, header http.Header, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	maps.Copy(req.Header, header)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func decodeBody[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("json.Unmarshal(%q) failed: %v", rec.Body.String(), err)
	}
	return v
}

func withRequestID(id string) http.Header {
	return http.Header{"X-Request-Id": {id}}
}

func TestHealth(t *testing.T) {
	tests := []struct {
		name       string
		pingErr    error
		wantStatus int
		wantBody   HealthResponse
	}{
		{
			name:       "database up",
			wantStatus: http.StatusOK,
			wantBody:   HealthResponse{Status: "ok", DB: "ok", Version: "test"},
		},
		{
			name:       "database down",
			pingErr:    errors.New("down"),
			wantStatus: http.StatusServiceUnavailable,
			wantBody:   HealthResponse{Status: "degraded", DB: "error", Version: "test"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, _ := newTestServer(t, tt.pingErr)
			rec := serve(s, http.MethodGet, "/health", nil, "")
			if rec.Code != tt.wantStatus {
				t.Errorf("GET /health status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if diff := cmp.Diff(tt.wantBody, decodeBody[HealthResponse](t, rec)); diff != "" {
				t.Errorf("GET /health body mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestHealthLogsPingFailure(t *testing.T) {
	s, logs := newTestServer(t, errors.New("down"))
	serve(s, http.MethodGet, "/health", nil, "")
	if !strings.Contains(logs.String(), "database ping failed") {
		t.Errorf("logs = %q, want a database ping failure", logs)
	}
}

func TestHeaders(t *testing.T) {
	s, _ := newTestServer(t, nil)
	rec := serve(s, http.MethodGet, "/health", withRequestID("abc"), "")
	want := map[string]string{
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy":        "no-referrer",
		"Cache-Control":          "no-store",
		"X-Request-Id":           "abc",
	}
	for k, v := range want {
		if got := rec.Header().Get(k); got != v {
			t.Errorf("header %s = %q, want %q", k, got, v)
		}
	}
}

func TestInvalidRequestIDIsReplaced(t *testing.T) {
	s, _ := newTestServer(t, nil)
	rec := serve(s, http.MethodGet, "/health", withRequestID("not valid"), "")
	if got := rec.Header().Get("X-Request-Id"); len(got) != 36 {
		t.Errorf("X-Request-Id = %q, want a generated UUID", got)
	}
}

func TestNotFound(t *testing.T) {
	tests := []struct {
		method string
		target string
	}{
		{http.MethodGet, "/"},
		{http.MethodGet, "/nope"},
		{http.MethodPost, "/health"},
	}
	want := ErrorResponse{Error: ErrorBody{Code: "not_found", Message: "Not found", RequestID: "r1"}}
	for _, tt := range tests {
		s, _ := newTestServer(t, nil)
		rec := serve(s, tt.method, tt.target, withRequestID("r1"), "")
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s status = %d, want %d", tt.method, tt.target, rec.Code, http.StatusNotFound)
		}
		if diff := cmp.Diff(want, decodeBody[ErrorResponse](t, rec)); diff != "" {
			t.Errorf("%s %s body mismatch (-want +got):\n%s", tt.method, tt.target, diff)
		}
	}
}

type item struct {
	Name string `json:"name"`
}

func (i *item) Validate() []voidbinder.Issue {
	if i.Name == "" {
		return []voidbinder.Issue{{Path: []any{"name"}, Message: "Too small: expected string to have >=1 characters"}}
	}
	return nil
}

func newErrorServer(t *testing.T) (*Server, *bytes.Buffer) {
	t.Helper()
	s, logs := newTestServer(t, nil)
	s.Handle("POST /items", func(w http.ResponseWriter, r *http.Request) error {
		var it item
		if err := DecodeJSON(w, r, &it); err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, it)
		return nil
	})
	s.Handle("GET /conflict", func(http.ResponseWriter, *http.Request) error {
		return &HTTPError{Status: http.StatusConflict, Message: "Already there"}
	})
	s.Handle("GET /boom", func(http.ResponseWriter, *http.Request) error {
		return errors.New("secret detail")
	})
	return s, logs
}

func TestValidationError(t *testing.T) {
	s, _ := newErrorServer(t)
	rec := serve(s, http.MethodPost, "/items", withRequestID("r2"), `{"name":""}`)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("POST /items status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	want := ErrorResponse{Error: ErrorBody{
		Code:      "invalid_request",
		Message:   "Invalid request",
		RequestID: "r2",
		Issues:    []voidbinder.Issue{{Path: []any{"name"}, Message: "Too small: expected string to have >=1 characters"}},
	}}
	if diff := cmp.Diff(want, decodeBody[ErrorResponse](t, rec)); diff != "" {
		t.Errorf("POST /items body mismatch (-want +got):\n%s", diff)
	}
}

func TestHTTPErrorKeepsStatus(t *testing.T) {
	s, _ := newErrorServer(t)
	rec := serve(s, http.MethodGet, "/conflict", withRequestID("r2"), "")
	if rec.Code != http.StatusConflict {
		t.Errorf("GET /conflict status = %d, want %d", rec.Code, http.StatusConflict)
	}
	want := ErrorResponse{Error: ErrorBody{Code: "conflict", Message: "Already there", RequestID: "r2"}}
	if diff := cmp.Diff(want, decodeBody[ErrorResponse](t, rec)); diff != "" {
		t.Errorf("GET /conflict body mismatch (-want +got):\n%s", diff)
	}
}

func TestInternalErrorDoesNotLeak(t *testing.T) {
	s, logs := newErrorServer(t)
	rec := serve(s, http.MethodGet, "/boom", withRequestID("r2"), "")
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("GET /boom status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
	if strings.Contains(rec.Body.String(), "secret detail") {
		t.Errorf("GET /boom body = %q, want no internal detail", rec.Body)
	}
	want := ErrorResponse{Error: ErrorBody{Code: "internal", Message: "Internal server error", RequestID: "r2"}}
	if diff := cmp.Diff(want, decodeBody[ErrorResponse](t, rec)); diff != "" {
		t.Errorf("GET /boom body mismatch (-want +got):\n%s", diff)
	}
	if !strings.Contains(logs.String(), "secret detail") {
		t.Errorf("logs = %q, want the internal detail", logs)
	}
}

func TestCORS(t *testing.T) {
	tests := []struct {
		origin     string
		wantOrigin string
	}{
		{"https://app.example.test", "https://app.example.test"},
		{ExpoWebDevOrigin, ExpoWebDevOrigin},
		{"https://evil.example", ""},
	}
	for _, tt := range tests {
		s, _ := newTestServer(t, nil)
		rec := serve(s, http.MethodGet, "/health", http.Header{"Origin": {tt.origin}}, "")
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != tt.wantOrigin {
			t.Errorf("Origin %s: Access-Control-Allow-Origin = %q, want %q", tt.origin, got, tt.wantOrigin)
		}
		wantCredentials := ""
		if tt.wantOrigin != "" {
			wantCredentials = "true"
		}
		if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != wantCredentials {
			t.Errorf("Origin %s: Access-Control-Allow-Credentials = %q, want %q", tt.origin, got, wantCredentials)
		}
	}
}

func TestCORSPreflight(t *testing.T) {
	s, _ := newTestServer(t, nil)
	rec := serve(s, http.MethodOptions, "/health", http.Header{
		"Origin":                         {"https://app.example.test"},
		"Access-Control-Request-Method":  {http.MethodPost},
		"Access-Control-Request-Headers": {"content-type"},
	}, "")
	if rec.Code != http.StatusNoContent {
		t.Errorf("preflight status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); got != "content-type" {
		t.Errorf("Access-Control-Allow-Headers = %q, want %q", got, "content-type")
	}
}

func TestAccessLog(t *testing.T) {
	s, logs := newTestServer(t, nil)
	serve(s, http.MethodGet, "/health", withRequestID("r3"), "")
	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1: %q", len(lines), logs)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &got); err != nil {
		t.Fatalf("json.Unmarshal(%q) failed: %v", lines[0], err)
	}
	delete(got, "ts")
	delete(got, "ms")
	want := map[string]any{
		"level":     "info",
		"message":   "request",
		"requestId": "r3",
		"method":    "GET",
		"path":      "/health",
		"status":    200.0,
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("access log mismatch (-want +got):\n%s", diff)
	}
}
