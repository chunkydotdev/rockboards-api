import { type Request, type Response, Router } from "express";
import { handleDbError } from "../lib/supabase";
import type { ApiResponse } from "../types";
import yahooFinance from "yahoo-finance2";

const router: Router = Router();

// GET /api/moonshot-realtime-prices/:ticker - Get real-time price for specific ticker
router.get("/:ticker", async (req: Request, res: Response) => {
	try {
		const { ticker } = req.params;

		if (!ticker) {
			return res.status(400).json({
				error: "Missing ticker parameter",
				message: "Ticker symbol is required",
			});
		}

		const tickerUpper = ticker.toUpperCase();

		try {
			const quote = await yahooFinance.quote(tickerUpper);

			const priceData = {
				ticker: tickerUpper,
				price: (quote as any)?.regularMarketPrice || 0,
				currency: (quote as any)?.currency || "USD",
				regularMarketPrice: (quote as any)?.regularMarketPrice || 0,
				regularMarketChange: (quote as any)?.regularMarketChange || 0,
				regularMarketChangePercent: (quote as any)?.regularMarketChangePercent || 0,
				regularMarketTime: (quote as any)?.regularMarketTime ? new Date((quote as any).regularMarketTime).toISOString() : null,
				regularMarketPreviousClose: (quote as any)?.regularMarketPreviousClose || 0,
				regularMarketOpen: (quote as any)?.regularMarketOpen || 0,
				regularMarketDayLow: (quote as any)?.regularMarketDayLow || 0,
				regularMarketDayHigh: (quote as any)?.regularMarketDayHigh || 0,
				regularMarketVolume: (quote as any)?.regularMarketVolume || 0,
				marketState: (quote as any)?.marketState || "UNKNOWN",
				exchangeName: (quote as any)?.exchange || "",
				fullExchangeName: (quote as any)?.fullExchangeName || "",
				displayName: (quote as any)?.displayName || tickerUpper,
				longName: (quote as any)?.longName || "",
				preMarketPrice: (quote as any)?.preMarketPrice || 0,
				preMarketChange: (quote as any)?.preMarketChange || 0,
				preMarketChangePercent: (quote as any)?.preMarketChangePercent || 0,
				preMarketTime: (quote as any)?.preMarketTime ? new Date((quote as any).preMarketTime).toISOString() : null,
				postMarketPrice: (quote as any)?.postMarketPrice || 0,
				postMarketChange: (quote as any)?.postMarketChange || 0,
				postMarketChangePercent: (quote as any)?.postMarketChangePercent || 0,
				postMarketTime: (quote as any)?.postMarketTime ? new Date((quote as any).postMarketTime).toISOString() : null,
			};

			const response: ApiResponse<typeof priceData> = {
				data: priceData,
			};

			res.json(response);
		} catch (yahooError) {
			console.error(`Yahoo Finance error for ${tickerUpper}:`, yahooError);
			return res.status(404).json({
				error: "Ticker not found",
				message: `Unable to fetch price data for ticker: ${tickerUpper}`,
			});
		}
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/moonshot-realtime-prices - Get real-time prices for multiple tickers
router.get("/", async (req: Request, res: Response) => {
	try {
		const { tickers } = req.query;

		if (!tickers) {
			return res.status(400).json({
				error: "Missing tickers parameter",
				message: "At least one ticker symbol is required (comma-separated for multiple)",
			});
		}

		const tickerList = (tickers as string)
			.split(",")
			.map(t => t.trim().toUpperCase())
			.filter(t => t.length > 0);

		if (tickerList.length === 0) {
			return res.status(400).json({
				error: "Invalid tickers parameter",
				message: "At least one valid ticker symbol is required",
			});
		}

		// Limit to 10 tickers per request to prevent abuse
		if (tickerList.length > 10) {
			return res.status(400).json({
				error: "Too many tickers",
				message: "Maximum of 10 tickers allowed per request",
			});
		}

		const pricePromises = tickerList.map(async (ticker) => {
			try {
				const quote = await yahooFinance.quote(ticker);
				return {
					ticker,
					success: true,
					data: {
						ticker,
						price: (quote as any)?.regularMarketPrice || 0,
						currency: (quote as any)?.currency || "USD",
						regularMarketPrice: (quote as any)?.regularMarketPrice || 0,
						regularMarketChange: (quote as any)?.regularMarketChange || 0,
						regularMarketChangePercent: (quote as any)?.regularMarketChangePercent || 0,
						regularMarketTime: (quote as any)?.regularMarketTime ? new Date((quote as any).regularMarketTime).toISOString() : null,
						regularMarketPreviousClose: (quote as any)?.regularMarketPreviousClose || 0,
						regularMarketOpen: (quote as any)?.regularMarketOpen || 0,
						regularMarketDayLow: (quote as any)?.regularMarketDayLow || 0,
						regularMarketDayHigh: (quote as any)?.regularMarketDayHigh || 0,
						regularMarketVolume: (quote as any)?.regularMarketVolume || 0,
						marketState: (quote as any)?.marketState || "UNKNOWN",
						exchangeName: (quote as any)?.exchange || "",
						fullExchangeName: (quote as any)?.fullExchangeName || "",
						displayName: (quote as any)?.displayName || ticker,
						longName: (quote as any)?.longName || "",
						preMarketPrice: (quote as any)?.preMarketPrice || 0,
						preMarketChange: (quote as any)?.preMarketChange || 0,
						preMarketChangePercent: (quote as any)?.preMarketChangePercent || 0,
						preMarketTime: (quote as any)?.preMarketTime ? new Date((quote as any).preMarketTime).toISOString() : null,
						postMarketPrice: (quote as any)?.postMarketPrice || 0,
						postMarketChange: (quote as any)?.postMarketChange || 0,
						postMarketChangePercent: (quote as any)?.postMarketChangePercent || 0,
						postMarketTime: (quote as any)?.postMarketTime ? new Date((quote as any).postMarketTime).toISOString() : null,
					},
				};
			} catch (error) {
				console.warn(`Failed to fetch price for ${ticker}:`, error);
				return {
					ticker,
					success: false,
					error: `Unable to fetch price data for ${ticker}`,
				};
			}
		});

		const results = await Promise.all(pricePromises);
		const successfulResults = results.filter(r => r.success).map(r => r.data);
		const failedResults = results.filter(r => !r.success);

		const response: ApiResponse<typeof successfulResults> = {
			data: successfulResults,
			message: failedResults.length > 0 
				? `Successfully fetched ${successfulResults.length}/${tickerList.length} prices. Failed tickers: ${failedResults.map(f => f.ticker).join(", ")}`
				: `Successfully fetched all ${successfulResults.length} prices`,
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

export default router;