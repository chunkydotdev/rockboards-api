import cors from "cors";
import express from "express";
import { validateEnvironment } from "./lib/env-validation";
import activityRouter from "./routes/activity";
import alternativeAssetPricesRouter from "./routes/alternative-asset-prices";
import alternativeAssetsRouter from "./routes/alternative-assets";
import companiesRouter from "./routes/companies";
import companyMetricsRouter from "./routes/company-metrics";
import eventsRouter from "./routes/events";
import mnavAlertsRouter from "./routes/mnav-alerts";
import mnavMonitorRouter from "./routes/mnav-monitor";
import optionsRouter from "./routes/options";
import pollsRouter from "./routes/polls";
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
			"https://btbt.rocks",
			"https://www.btbt.rocks",
			"https://ethz.rocks",
			"https://www.ethz.rocks",
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

// Public routes - allow ALL origins for embeds (credentials disabled for security)
app.use(
	"/api/stock-prices",
	cors({ origin: "*", credentials: false }),
	stockPricesRouter,
);
app.use(
	"/api/company-metrics",
	cors({ origin: "*", credentials: false }),
	companyMetricsRouter,
);
app.use(
	"/api/companies",
	cors({ origin: "*", credentials: false }),
	companiesRouter,
);
app.use("/api/events", cors({ origin: "*", credentials: false }), eventsRouter);

// Protected routes - strict CORS whitelist
app.use("/api/polls", cors(corsOptions), pollsRouter);
app.use("/api/activity", cors(corsOptions), activityRouter);
app.use("/api/mnav-alerts", cors(corsOptions), mnavAlertsRouter);
app.use("/api/mnav-monitor", cors(corsOptions), mnavMonitorRouter);
app.use("/api/alternative-assets", cors(corsOptions), alternativeAssetsRouter);
app.use(
	"/api/alternative-asset-prices",
	cors(corsOptions),
	alternativeAssetPricesRouter,
);
app.use("/api/options", cors(corsOptions), optionsRouter);
app.use("/api/options/realtime", cors(corsOptions), realtimeOptionsRouter);

// Realtime stock prices inherits open CORS from /api/stock-prices above
// Must be registered AFTER base route to work correctly
app.use("/api/stock-prices/realtime", realtimeStockPricesRouter);

// Health check endpoint
app.get("/api/health", cors({ origin: "*", credentials: false }), (req, res) => {
	res.json({
		status: "healthy",
		timestamp: new Date().toISOString(),
		service: "bmnr-api-service",
	});
});

app.get("/", (req, res) => {
	res.json({
		message: "BMNR API Service",
		version: "1.0.0",
		endpoints: [
			"/api/health",
			"/api/stock-prices",
			"/api/stock-prices/realtime/:ticker",
			"/api/stock-prices/realtime/update",
			"/api/companies",
			"/api/companies/ticker/:ticker",
			"/api/company-metrics",
			"/api/events",
			"/api/alternative-assets",
			"/api/alternative-asset-prices",
			"/api/options",
			"/api/options/realtime/:ticker",
			"/api/activity/track",
			"/api/activity/stats",
			"/api/polls/daily",
			"/api/polls/daily/vote",
			"/api/polls/daily/votes",
			"/api/polls/daily/settle",
			"/api/polls/daily/auto-create",
			"/api/polls/daily/auto-settle",
			"/api/mnav-alerts",
			"/api/mnav-alerts/:id",
			"/api/mnav-alerts/triggered",
			"/api/mnav-alerts/mark-sent",
			"/api/mnav-alerts/stats",
			"/api/mnav-monitor/check",
			"/api/mnav-monitor/status",
		],
	});
});

// Global error handler
app.use(
	(
		err: Error,
		req: express.Request,
		res: express.Response,
		_next: express.NextFunction,
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
	console.log(`📍 Health check: http://localhost:${port}/api/health`);
	console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});

export default app;
