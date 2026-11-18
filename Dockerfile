# One image: the Go server, the built app, the formats, and sample content for a first start.
# Build:  docker build -t process-manager .
# Run:    see docs/backend.md for the settings it needs (database, sign-in, first admins).
#         The default command is the portal server. The MCP server for agents (docs/mcp.md) is in
#         the same image: run a second container with the entrypoint /app/mcp, e.g.
#         docker run --entrypoint /app/mcp -e DATABASE_URL=… -e PM_MCP_ADDR=0.0.0.0:8081 -e PM_MCP_SECRET=… process-manager
#         (in Kubernetes: command: ["/app/mcp"]).

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
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/mcp ./cmd/mcp

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=server /out/server /app/server
COPY --from=server /out/mcp /app/mcp
COPY --from=web /app/dist /app/dist
# The formats the server checks every save against.
COPY schema /app/seed/schema
# Loaded only when the database is empty. After that the database is the only source.
COPY processes /app/seed/processes
COPY standards /app/seed/standards
COPY catalog /app/seed/catalog
ENV PM_ADDR=0.0.0.0:8080 \
    PM_STATIC_DIR=/app/dist \
    PM_SEED_DIR=/app/seed
# 8080: the portal; 8081: the MCP server, when that is what the container runs
EXPOSE 8080 8081
ENTRYPOINT ["/app/server"]
