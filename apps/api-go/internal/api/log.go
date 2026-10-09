package api

import (
	"io"
	"log/slog"
	"strings"
)

const logTimeFormat = "2006-01-02T15:04:05.000Z07:00"

func NewLogger(w io.Writer) *slog.Logger {
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{ReplaceAttr: renameLogAttr}))
}

func renameLogAttr(groups []string, a slog.Attr) slog.Attr {
	if len(groups) > 0 {
		return a
	}
	switch a.Key {
	case slog.TimeKey:
		return slog.String("ts", a.Value.Time().UTC().Format(logTimeFormat))
	case slog.LevelKey:
		return slog.String(slog.LevelKey, strings.ToLower(a.Value.String()))
	case slog.MessageKey:
		return slog.Attr{Key: "message", Value: a.Value}
	}
	return a
}
