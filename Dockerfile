# Use official Node.js image as base
FROM node:18-slim

# Install Chrome dependencies and Chrome itself
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create pptuser for running Puppeteer
RUN groupadd -r pptuser && useradd -r -g pptuser -G audio,video pptuser \
    && mkdir -p /home/pptuser/Downloads \
    && chown -R pptuser:pptuser /home/pptuser

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies with optimized npm settings
RUN npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-timeout 300000 && \
    npm install --omit=dev --no-audit --no-fund --verbose

# Copy application code
COPY server.js ./

# Change ownership of /app to pptuser
RUN chown -R pptuser:pptuser /app

# Switch to pptuser for security
USER pptuser

# Expose port
EXPOSE 8080

# Start the application
CMD ["node", "server.js"]
