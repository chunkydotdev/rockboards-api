import { type Request, type Response, Router } from "express";
import yahooFinance from "yahoo-finance2";
import { handleDbError, supabase } from "../lib/supabase";
import type { ApiResponse, RealtimeStockPrice } from "../types";

const router: Router = Router();

// GET /api/stock-prices/realtime/:ticker - Real-time stock price for specific ticker
router.get("/:ticker", async (req: Request, res: Response) => {
	try {
		const { ticker } = req.params;

		if (!ticker) {
			return res.status(400).json({
				error: "Ticker symbol is required",
			});
		}

		// First try to get data from Supabase (using public client with RLS)
		const { data: supabaseData, error: supabaseError } = await supabase
			.from("realtime_stock_prices")
			.select("*")
			.eq("ticker", ticker.toUpperCase())
			.single();

		// Check if data is fresh (less than 2 minutes old)
		const isDataFresh =
			supabaseData &&
			new Date().getTime() - new Date(supabaseData.last_updated).getTime() <
				2 * 60 * 1000;

		let realtimeData: RealtimeStockPrice;

		if (isDataFresh && !supabaseError) {
			// Use Supabase data if fresh
			realtimeData = {
				ticker: supabaseData.ticker,
				price: Number(supabaseData.price),
				currency: supabaseData.currency,
				regularMarketPrice: Number(supabaseData.regular_market_price || 0),
				regularMarketChange: Number(supabaseData.regular_market_change || 0),
				regularMarketChangePercent: Number(
					supabaseData.regular_market_change_percent || 0,
				),
				regularMarketTime:
					supabaseData.regular_market_time || new Date().toISOString(),
				regularMarketPreviousClose: Number(
					supabaseData.regular_market_previous_close || 0,
				),
				regularMarketOpen: Number(supabaseData.regular_market_open || 0),
				regularMarketDayLow: Number(supabaseData.regular_market_day_low || 0),
				regularMarketDayHigh: Number(supabaseData.regular_market_day_high || 0),
				regularMarketVolume: Number(supabaseData.regular_market_volume || 0),
				marketState: supabaseData.market_state || "UNKNOWN",
				exchangeName: supabaseData.exchange_name || "",
				fullExchangeName: supabaseData.full_exchange_name || "",
				displayName: supabaseData.display_name || ticker.toUpperCase(),
				longName: supabaseData.long_name || ticker.toUpperCase(),
				preMarketPrice: Number(supabaseData.pre_market_price || 0),
				preMarketChange: Number(supabaseData.pre_market_change || 0),
				preMarketChangePercent: Number(
					supabaseData.pre_market_change_percent || 0,
				),
				preMarketTime: supabaseData.pre_market_time || new Date().toISOString(),
				postMarketPrice: Number(supabaseData.post_market_price || 0),
				postMarketChange: Number(supabaseData.post_market_change || 0),
				postMarketChangePercent: Number(
					supabaseData.post_market_change_percent || 0,
				),
				postMarketTime:
					supabaseData.post_market_time || new Date().toISOString(),
			};
		} else {
			// Fallback to Yahoo Finance if Supabase data is stale or missing
			const quote = await yahooFinance.quote(ticker.toUpperCase());

			if (!quote) {
				return res.status(404).json({
					error: `No data found for ticker ${ticker}`,
				});
			}

			// Extract relevant price information
			realtimeData = {
				ticker: ticker.toUpperCase(),
				price: quote.regularMarketPrice || 0,
				currency: quote.currency || "USD",
				postMarketPrice: quote.postMarketPrice || 0,
				postMarketChange: quote.postMarketChange || 0,
				postMarketChangePercent: quote.postMarketChangePercent || 0,
				postMarketTime:
					quote.postMarketTime && typeof quote.postMarketTime === "number"
						? new Date(quote.postMarketTime * 1000).toISOString()
						: new Date().toISOString(),
				preMarketPrice: quote.preMarketPrice || 0,
				preMarketChange: quote.preMarketChange || 0,
				preMarketChangePercent: quote.preMarketChangePercent || 0,
				preMarketTime:
					quote.preMarketTime && typeof quote.preMarketTime === "number"
						? new Date(quote.preMarketTime * 1000).toISOString()
						: new Date().toISOString(),
				regularMarketPrice: quote.regularMarketPrice || 0,
				regularMarketChange: quote.regularMarketChange || 0,
				regularMarketChangePercent: quote.regularMarketChangePercent || 0,
				regularMarketTime:
					quote.regularMarketTime && typeof quote.regularMarketTime === "number"
						? new Date(quote.regularMarketTime * 1000).toISOString()
						: new Date().toISOString(),
				regularMarketPreviousClose: quote.regularMarketPreviousClose || 0,
				regularMarketOpen: quote.regularMarketOpen || 0,
				regularMarketDayLow: quote.regularMarketDayLow || 0,
				regularMarketDayHigh: quote.regularMarketDayHigh || 0,
				regularMarketVolume: quote.regularMarketVolume || 0,
				marketState: quote.marketState || "UNKNOWN",
				exchangeName: quote.exchange || "",
				fullExchangeName: quote.fullExchangeName || "",
				displayName: quote.displayName || ticker.toUpperCase(),
				longName: quote.longName || ticker.toUpperCase(),
			};
		}

		const response: ApiResponse<RealtimeStockPrice> = {
			data: realtimeData,
		};

		// Add cache headers (cache for 10 seconds)
		res.set({
			"Cache-Control": "public, max-age=10, stale-while-revalidate=5",
		});

		res.json(response);
	} catch (error) {
		console.error("Error fetching real-time stock price:", error);

		// Handle specific Yahoo Finance errors
		if (error instanceof Error) {
			if (
				error.message.includes("Not Found") ||
				error.message.includes("404")
			) {
				return res.status(404).json({
					error: `Ticker ${req.params.ticker} not found`,
				});
			}
		}

		res.status(500).json(handleDbError(error));
	}
});

export default router;
