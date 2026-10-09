package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/m0r4a/Voidbinder/apps/api-go/internal/voidbinder"
)

const maxBodyBytes = 1 << 20

var errorCodes = map[int]string{
	http.StatusBadRequest:            "bad_request",
	http.StatusUnauthorized:          "unauthorized",
	http.StatusForbidden:             "forbidden",
	http.StatusNotFound:              "not_found",
	http.StatusMethodNotAllowed:      "method_not_allowed",
	http.StatusConflict:              "conflict",
	http.StatusRequestEntityTooLarge: "payload_too_large",
	http.StatusTooManyRequests:       "rate_limited",
}

type ErrorResponse struct {
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Code      string             `json:"code"`
	Message   string             `json:"message"`
	RequestID string             `json:"requestId"`
	Issues    []voidbinder.Issue `json:"issues,omitempty"`
}

type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("http %d: %s", e.Status, e.Message)
}

type ValidationError struct {
	Issues []voidbinder.Issue
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("invalid request: %d issues", len(e.Issues))
}

type Validator interface {
	Validate() []voidbinder.Issue
}

func DecodeJSON(w http.ResponseWriter, r *http.Request, v Validator) error {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBodyBytes)).Decode(v); err != nil {
		return &ValidationError{Issues: []voidbinder.Issue{{Path: []any{}, Message: "Malformed JSON body"}}}
	}
	if issues := v.Validate(); len(issues) > 0 {
		return &ValidationError{Issues: issues}
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, r *http.Request, status int, code, message string, issues []voidbinder.Issue) {
	writeJSON(w, status, ErrorResponse{Error: ErrorBody{
		Code:      code,
		Message:   message,
		RequestID: RequestID(r.Context()),
		Issues:    issues,
	}})
}

type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

func (s *Server) errorHandler(h HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := h(w, r)
		if err == nil {
			return
		}
		var verr *ValidationError
		var herr *HTTPError
		switch {
		case errors.As(err, &verr):
			writeError(w, r, http.StatusBadRequest, "invalid_request", "Invalid request", verr.Issues)
		case errors.As(err, &herr) && herr.Status < http.StatusInternalServerError:
			code, ok := errorCodes[herr.Status]
			if !ok {
				code = "bad_request"
			}
			message := herr.Message
			if message == "" {
				message = "Bad request"
			}
			writeError(w, r, herr.Status, code, message, nil)
		default:
			s.logger.LogAttrs(r.Context(), slog.LevelError, err.Error(), slog.String("requestId", RequestID(r.Context())))
			writeError(w, r, http.StatusInternalServerError, "internal", "Internal server error", nil)
		}
	})
}

func notFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, r, http.StatusNotFound, "not_found", "Not found", nil)
}
