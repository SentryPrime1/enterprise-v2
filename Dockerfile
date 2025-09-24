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

                                            # Create pptruser for running Puppeteer
                                            RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
                                                && mkdir -p /home/pptruser/Downloads \
                                                    && chown -R pptruser:pptruser /home/pptruser

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

                                                    # Switch to pptruser for security
                                                    USER pptruser

                                                    # Expose port
                                                    EXPOSE 8080

                                                    # Start the application
                                                    CMD ["node", "server.js"]
