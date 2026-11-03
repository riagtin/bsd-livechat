FROM alpine:latest

# Install runtime dependencies:
# - ca-certificates: Required for secure HTTPS requests to Meta WhatsApp Cloud API (graph.facebook.com)
# - tzdata: Required for Asia/Jakarta (WIB) timezone alignment
# - libstdc++ & libgcc: Required for executing the native compiled binary on Alpine musl
# - wget: Required for container healthcheck probe
RUN apk --no-cache add ca-certificates tzdata libstdc++ libgcc wget && \
    addgroup -S appgroup && \
    adduser -S appuser -G appgroup

WORKDIR /app

# Salin binary Linux yang telah dikompilasi dan widget script
COPY --chown=appuser:appgroup livechat-backend .
COPY --chown=appuser:appgroup widget.js* .
RUN chmod +x livechat-backend

# Jalankan container sebagai non-root demi keamanan
USER appuser

# Expose port service API (internal port 3100)
EXPOSE 3100

# Healthcheck probe container
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/health || exit 1

# Eksekusi server backend
CMD ["./livechat-backend"]
