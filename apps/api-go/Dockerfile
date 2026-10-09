FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
ARG VERSION=local
ENV VERSION=$VERSION PORT=8787
COPY --from=build /out/api /api
EXPOSE 8787
USER nonroot:nonroot
ENTRYPOINT ["/api"]
