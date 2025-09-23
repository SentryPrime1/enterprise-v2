# Use official Puppeteer image (has Chrome pre-installed)
FROM ghcr.io/puppeteer/puppeteer:21.6.1

# Switch to root to install dependencies
USER root

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies as root (avoids permission issues)
RUN npm ci --only=production --no-audit --no-fund

# Copy application code
COPY server.js ./

# Change ownership of /app to pptruser
RUN chown -R pptruser:pptruser /app

# Switch back to pptruser for security
USER pptruser

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]
