# Multi-stage build for Node.js API service
FROM node:20-alpine AS base

# Install pnpm globally
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY tsconfig.json ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Development stage
FROM base AS development
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 4000
CMD ["pnpm", "run", "dev"]

# Build stage
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Production stage
FROM node:20-alpine AS production

# Install pnpm globally
RUN npm install -g pnpm

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S apiservice -u 1001

WORKDIR /app

# Copy package files and install production dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Copy built application with proper ownership
COPY --from=build --chown=apiservice:nodejs /app/dist ./dist

COPY .env .env

# Switch to non-root user
USER apiservice

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

# Start application
CMD ["node", "dist/index.js"]