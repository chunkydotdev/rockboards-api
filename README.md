# BMNR API Service

A standalone Node.js API service that provides stock market data and company information for BMNR dashboards. This service allows multiple dashboard applications to consume the same endpoints without duplicating backend logic.

## 🚀 Features

- **Stock Price Data**: Historical and real-time stock prices
- **Company Information**: Company details, metrics, and events
- **Options Data**: Options analytics and real-time options data
- **Cross-Origin Support**: CORS configured for multiple domains
- **TypeScript**: Full TypeScript support with type definitions
- **Docker Ready**: Containerized for easy deployment
- **Health Monitoring**: Built-in health checks

## 📋 Prerequisites

- Node.js 20+
- npm or yarn
- Supabase database access
- Environment variables configured

## 🛠️ Quick Start

### Development Setup

1. **Clone and Navigate**
   ```bash
   cd api-service
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Environment Configuration**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start Development Server**
   ```bash
   npm run dev
   ```

   The service will be available at `http://localhost:4000`

### Docker Setup

```bash
# Development
docker-compose up

# Production
docker-compose --profile production up
```

## 🌐 API Endpoints

### Health Check
- `GET /health` - Service health status

### Stock Prices
- `GET /api/stock-prices` - Historical stock prices
  - Query params: `company_id`, `ticker`, `from_date`, `to_date`, `limit`
- `GET /api/stock-prices/realtime/:ticker` - Real-time stock price

### Companies
- `GET /api/companies` - List all companies
- `GET /api/companies/ticker/:ticker` - Company by ticker
  - Query params: `include=company_metrics,stock_prices,events`

### Company Metrics
- `GET /api/company-metrics` - Company financial metrics
  - Query params: `company_id`, `ticker`, `from_date`, `to_date`, `limit`

### Events
- `GET /api/events` - Company events and news
  - Query params: `company_id`, `ticker`, `from_date`, `to_date`, `limit`

### Options
- `GET /api/options` - Processed options data
  - Query params: `ticker` (required), `date` (optional)
- `GET /api/options/realtime/:ticker` - Real-time options data

## 📖 Usage Examples

### Fetch Real-time Stock Price
```javascript
const response = await fetch('https://api.bmnr.rocks/api/stock-prices/realtime/AAPL');
const { data } = await response.json();
console.log(data.regularMarketPrice);
```

### Get Company with Related Data
```javascript
const response = await fetch(
  'https://api.bmnr.rocks/api/companies/ticker/TSLA?include=company_metrics,stock_prices'
);
const { data } = await response.json();
console.log(data.company_metrics);
```

### Historical Stock Prices
```javascript
const response = await fetch(
  'https://api.bmnr.rocks/api/stock-prices?ticker=MSFT&from_date=2024-01-01&limit=100'
);
const { data } = await response.json();
```

### Options Data
```javascript
const response = await fetch('https://api.bmnr.rocks/api/options?ticker=SPY');
const { data } = await response.json();
console.log(data.impliedVolatility, data.putCallRatio);
```

## 🔧 Environment Variables

Required variables:
```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Server Configuration
PORT=4000
NODE_ENV=development

# CORS Configuration
ALLOWED_ORIGINS=https://bmnr.rocks,https://sbet.rocks,http://localhost:3000
```

## 🔐 CORS Configuration

The service is configured to accept requests from:
- `https://bmnr.rocks`
- `https://www.bmnr.rocks`
- `https://sbet.rocks`
- `https://www.sbet.rocks`
- `http://localhost:3000` (development)
- `http://localhost:3001` (development)

Additional origins can be configured via the `ALLOWED_ORIGINS` environment variable.

## 📝 Response Format

All endpoints return data in this format:
```json
{
  "data": { ... },
  "error": "optional error message",
  "message": "optional info message"
}
```

## 🚀 Deployment

### Using Docker

```bash
# Build production image
docker build --target production -t bmnr-api-service .

# Run container
docker run -p 4000:4000 --env-file .env bmnr-api-service
```

### Manual Deployment

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

## 🔍 Monitoring

- Health check endpoint: `/health`
- Built-in request logging
- Error handling with stack traces in development

## 🤝 Integration Guide

### Switching from Next.js API Routes

1. **Update API Base URL**
   ```javascript
   // Before
   const apiUrl = '/api/stock-prices/realtime/AAPL';
   
   // After
   const apiUrl = 'https://api.bmnr.rocks/api/stock-prices/realtime/AAPL';
   ```

2. **No Changes to Request/Response Format**
   - All endpoints maintain the same request parameters
   - Response formats are identical to Next.js versions

3. **Update CORS Headers** (if making requests from browser)
   ```javascript
   fetch(apiUrl, {
     method: 'GET',
     headers: {
       'Content-Type': 'application/json',
       // No additional headers needed for GET requests
     }
   });
   ```

## 🛠️ Development

### Scripts
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run type-check` - TypeScript type checking

### Project Structure
```
src/
├── routes/           # API route handlers
├── lib/              # Shared utilities
├── types/            # TypeScript type definitions
└── index.ts          # Express app entry point
```

## 📄 License

MIT License - see LICENSE file for details.