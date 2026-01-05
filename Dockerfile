# D-Shield Runtime Docker Image
# For deployment on Phala Network d-stack (TDX)

FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies (including gcc for LD_PRELOAD shim)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    gcc \
    libc6-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY examples/ ./examples/
COPY scripts/ ./scripts/

# Build TypeScript
RUN npm run build

# Compile LD_PRELOAD shim
RUN mkdir -p build/isolation && \
    gcc -shared -fPIC -o build/isolation/libdshield.so \
    src/isolation/ld-preload-shim.c -ldl -Wall -Wextra

# Production image
FROM node:20-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    iptables \
    iproute2 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy built files and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/examples ./examples
COPY --from=builder /app/build/isolation ./build/isolation
COPY --from=builder /app/scripts ./scripts

# Copy wrapper scripts
COPY src/runtime/wrappers ./dist/src/runtime/wrappers

# Make scripts executable
RUN chmod +x scripts/*.sh

# Create non-root user for function execution
RUN useradd -m -s /bin/bash dshield

# Environment variables
ENV NODE_ENV=production
ENV DSHIELD_PORT=3000

# Expose the runtime port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Default command
CMD ["node", "dist/src/runtime/cli.js"]
