# Use official Puppeteer image (has Chrome pre-installed)
FROM ghcr.io/puppeteer/puppeteer:21.6.1

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies as root (puppeteer base image runs as root by default)
RUN npm ci --only=production --no-audit --no-fund

# Copy application code
COPY server.js ./

# Create non-root user for security (but run npm as root first)
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /app \
    && chown -R pptruser:pptruser /home/pptruser

# Switch to non-root user
USER pptruser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http' ).get('http://localhost:8080/health', (res ) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["node", "server.js"]
