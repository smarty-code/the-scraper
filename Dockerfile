FROM oven/bun:1.3.14

# Install system dependencies required for running headless Chromium
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libharfbuzz0b \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency definition files
COPY package.json bun.lock ./

# Install project dependencies
RUN bun install

# Install Playwright Chromium browser binary and its execution dependencies
RUN bunx playwright install chromium

# Copy remaining source code files
COPY . .

# Expose the API port
EXPOSE 3000

# Run the automation server
CMD ["bun", "run", "index.ts"]
