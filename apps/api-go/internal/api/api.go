package api

import (
	"log/slog"
	"net/http"

	"github.com/m0r4a/Voidbinder/apps/api-go/internal/voidbinder"
)

const ExpoWebDevOrigin = "http://localhost:8081"

type Platform struct {
	CardStore voidbinder.CardStore
	BlobStore voidbinder.BlobStore
}

type Config struct {
	AppURL   string
	Version  string
	Platform Platform
	Logger   *slog.Logger
}

type Server struct {
	mux     *http.ServeMux
	logger  *slog.Logger
	origins []string
}

func New(cfg Config) *Server {
	s := &Server{
		mux:     http.NewServeMux(),
		logger:  cfg.Logger,
		origins: []string{cfg.AppURL, ExpoWebDevOrigin},
	}
	if s.logger == nil {
		s.logger = slog.Default()
	}
	s.mux.Handle("GET /health", s.handleHealth(cfg.Version, cfg.Platform.CardStore))
	s.mux.HandleFunc("/", notFound)
	return s
}

func (s *Server) Handle(pattern string, h HandlerFunc) {
	s.mux.Handle(pattern, s.errorHandler(h))
}
