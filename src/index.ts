import cors from "cors";
import express from "express";
import { validateEnvironment } from "./lib/env-validation";
import companiesRouter from "./routes/companies";
import companyMetricsRouter from "./routes/company-metrics";
import eventsRouter from "./routes/events";
import moonshotInvestmentsRouter from "./routes/moonshot-investments";
import moonshotTransactionsRouter from "./routes/moonshot-transactions";
import moonshotRealtimePricesRouter from "./routes/moonshot-realtime-prices";
import optionsRouter from "./routes/options";
import realtimeOptionsRouter from "./routes/realtime-options";
import realtimeStockPricesRouter from "./routes/realtime-stock-prices";
import stockPricesRouter from "./routes/stock-prices";

// Validate required environment variables
validateEnvironment();

const app: express.Express = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(express.json());

// CORS Configuration for cross-domain access
const corsOptions = {
	origin: (
		origin: string | undefined,
		callback: (err: Error | null, allow?: boolean) => void,
	) => {
		// Allow requests with no origin (like mobile apps or curl requests)
		if (!origin) return callback(null, true);

		// Environment-based domain whitelist
		const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [
			"https://bmnr.rocks",
			"https://www.bmnr.rocks",
			"https://sbet.rocks",
			"https://www.sbet.rocks",
			"http://localhost:3000",
			"http://localhost:3001",
		];

		if (allowedOrigins.includes(origin)) {
			callback(null, true);
		} else {
			callback(new Error("Not allowed by CORS"));
		}
	},
	credentials: true,
	methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
	allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));

// Health check endpoint
app.get("/health", (req, res) => {
	res.json({
		status: "healthy",
		timestamp: new Date().toISOString(),
		service: "bmnr-api-service",
	});
});

// API routes
app.use("/api/stock-prices/realtime", realtimeStockPricesRouter);
app.use("/api/stock-prices", stockPricesRouter);
app.use("/api/companies", companiesRouter);
app.use("/api/company-metrics", companyMetricsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/moonshot-investments", moonshotInvestmentsRouter);
app.use("/api/moonshot-transactions", moonshotTransactionsRouter);
app.use("/api/moonshot-realtime-prices", moonshotRealtimePricesRouter);
app.use("/api/options/realtime", realtimeOptionsRouter);
app.use("/api/options", optionsRouter);

app.get("/", (req, res) => {
	res.json({
		message: "BMNR API Service",
		version: "1.0.0",
		endpoints: [
			"/health",
			"/api/stock-prices",
			"/api/stock-prices/realtime/:ticker",
			"/api/companies",
			"/api/companies/ticker/:ticker",
			"/api/company-metrics",
			"/api/events",
			"/api/moonshot-investments",
			"/api/moonshot-transactions",
			"/api/moonshot-realtime-prices/:ticker",
			"/api/options",
			"/api/options/realtime/:ticker",
		],
	});
});

// Global error handler
app.use(
	(
		err: Error,
		req: express.Request,
		res: express.Response,
		next: express.NextFunction,
	) => {
		console.error("Unhandled error:", err);
		res.status(500).json({
			error: "Internal server error",
			message:
				process.env.NODE_ENV === "development"
					? err.message
					: "Something went wrong",
		});
	},
);

// 404 handler
app.use("*", (req, res) => {
	res.status(404).json({
		error: "Endpoint not found",
		path: req.originalUrl,
	});
});

app.listen(port, () => {
	console.log(`🚀 BMNR API Service running on port ${port}`);
	console.log(`📍 Health check: http://localhost:${port}/health`);
	console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});

export default app;
