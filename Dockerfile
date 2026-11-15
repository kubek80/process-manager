# One image: the Go server, the built app, and the process files from the repository.
# Build:  docker build -t process-manager .
# Run:    see docs/backend.md for the settings it needs (database, sign-in).

FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run validate && npm run build

FROM golang:1.26-alpine AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=server /out/server /app/server
COPY --from=web /app/dist /app/dist
COPY processes /app/content/processes
COPY catalog /app/content/catalog
COPY config /app/content/config
# Content comes from the repository: the running app never writes it.
ENV PM_ADDR=0.0.0.0:8080 \
    PM_STATIC_DIR=/app/dist \
    PM_CONTENT_DIR=/app/content \
    PM_CONTENT_WRITABLE=false
EXPOSE 8080
ENTRYPOINT ["/app/server"]
