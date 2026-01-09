import { type Request, type Response, Router } from "express";
import yahooFinance from "yahoo-finance2";
import { handleDbError, supabase, supabaseServiceRole } from "../lib/supabase";
import type {
	ApiResponse,
	CachedRealtimeStockPrice,
	RealtimeStockPrice,
} from "../types";

// Marketstack API configuration
const MARKETSTACK_API_KEY = process.env.MARKETSTACK_API_KEY;
const MARKETSTACK_BASE_URL = "https://api.marketstack.com/v2";

// Marketstack API response type
interface MarketstackStockPriceItem {
	ticker: string;
	exchange_code: string;
	exchange_name: string;
	country: string;
	price: string; // API returns price as string
	currency: string;
	trade_last: string;
}

interface MarketstackApiResponse {
	data: MarketstackStockPriceItem[];
}

interface MarketstackStockPriceResponse {
	ticker: string;
	exchange_name: string;
	price: number;
	currency: string;
	trade_last: string;
}

// Preferred US exchanges in order of priority
const US_EXCHANGES = ["NASDAQ", "NYSE", "NYSEARCA", "BATS", "AMEX"];

// Helper to check if ticker is a crypto/currency
function isCryptoTicker(ticker: string): boolean {
	const upperTicker = ticker.toUpperCase();
	return (
		upperTicker === "ETHUSD" ||
		upperTicker === "BTCUSD" ||
		upperTicker.endsWith("-USD") ||
		upperTicker.includes("BTC") ||
		upperTicker.includes("ETH")
	);
}

// Helper function to fetch stock price from Marketstack API (single ticker)
async function fetchFromMarketstack(
	ticker: string,
): Promise<MarketstackStockPriceResponse | null> {
	if (
		!MARKETSTACK_API_KEY ||
		MARKETSTACK_API_KEY === "your_marketstack_api_key_here"
	) {
		console.warn("Marketstack API key not configured");
		return null;
	}

	try {
		const url = new URL(`${MARKETSTACK_BASE_URL}/stockprice`);
		url.searchParams.append("access_key", MARKETSTACK_API_KEY);
		url.searchParams.append("ticker", ticker);

		const response = await fetch(url.toString());
		const responseText = await response.text();

		if (!response.ok) {
			console.error(
				`Marketstack API error: ${response.status} ${response.statusText}`,
			);
			return null;
		}

		const apiResponse = JSON.parse(responseText) as MarketstackApiResponse;

		if (!apiResponse?.data || apiResponse.data.length === 0) {
			console.warn(`Marketstack: No data for ${ticker}`);
			return null;
		}

		// Find US exchange data (prefer NASDAQ, then NYSE, etc.)
		let stockData: MarketstackStockPriceItem | undefined;
		for (const exchange of US_EXCHANGES) {
			stockData = apiResponse.data.find(
				(item) => item.exchange_code === exchange,
			);
			if (stockData) break;
		}

		// Fallback to first USD result if no US exchange found
		if (!stockData) {
			stockData = apiResponse.data.find((item) => item.currency === "USD");
		}

		// Last resort: use first result
		if (!stockData) {
			stockData = apiResponse.data[0];
		}

		const price = parseFloat(stockData.price);
		if (Number.isNaN(price)) {
			console.warn(`Marketstack: Invalid price for ${ticker}`);
			return null;
		}

		console.log(
			`Marketstack: ${ticker} -> ${price} USD (${stockData.exchange_name})`,
		);

		return {
			ticker: stockData.ticker,
			exchange_name: stockData.exchange_name,
			price: price,
			currency: stockData.currency,
			trade_last: stockData.trade_last,
		};
	} catch (error) {
		console.error(`Marketstack fetch error for ${ticker}:`, error);
		return null;
	}
}

// Extended type for Yahoo Finance quote response
interface YahooQuoteResponse {
	regularMarketPrice?: number;
	currency?: string;
	regularMarketChange?: number;
	regularMarketChangePercent?: number;
	regularMarketTime?: number;
	regularMarketPreviousClose?: number;
	regularMarketOpen?: number;
	regularMarketDayLow?: number;
	regularMarketDayHigh?: number;
	regularMarketVolume?: number;
	marketState?: string;
	exchange?: string;
	fullExchangeName?: string;
	displayName?: string;
	longName?: string;
	preMarketPrice?: number;
	preMarketChange?: number;
	preMarketChangePercent?: number;
	preMarketTime?: number;
	postMarketPrice?: number;
	postMarketChange?: number;
	postMarketChangePercent?: number;
	postMarketTime?: number;
}

const router: Router = Router();

// In-memory cache for 15-minute cached prices
interface CacheEntry {
	data: RealtimeStockPrice;
	timestamp: number;
}

const priceCache = new Map<string, CacheEntry>();
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

// Helper function to convert Supabase data to RealtimeStockPrice format
function convertSupabaseToRealtimePrice(
	supabaseData: Record<string, unknown>,
	ticker: string,
): RealtimeStockPrice {
	return {
		ticker: supabaseData.ticker as string,
		price: Number(supabaseData.price),
		currency: supabaseData.currency as string,
		regularMarketPrice: Number(supabaseData.regular_market_price || 0),
		regularMarketChange: Number(supabaseData.regular_market_change || 0),
		regularMarketChangePercent: Number(
			supabaseData.regular_market_change_percent || 0,
		),
		regularMarketTime:
			(supabaseData.regular_market_time as string) || new Date().toISOString(),
		regularMarketPreviousClose: Number(
			supabaseData.regular_market_previous_close || 0,
		),
		regularMarketOpen: Number(supabaseData.regular_market_open || 0),
		regularMarketDayLow: Number(supabaseData.regular_market_day_low || 0),
		regularMarketDayHigh: Number(supabaseData.regular_market_day_high || 0),
		regularMarketVolume: Number(supabaseData.regular_market_volume || 0),
		marketState: (supabaseData.market_state as string) || "UNKNOWN",
		exchangeName: (supabaseData.exchange_name as string) || "",
		fullExchangeName: (supabaseData.full_exchange_name as string) || "",
		displayName: (supabaseData.display_name as string) || ticker.toUpperCase(),
		longName: (supabaseData.long_name as string) || ticker.toUpperCase(),
		preMarketPrice: Number(supabaseData.pre_market_price || 0),
		preMarketChange: Number(supabaseData.pre_market_change || 0),
		preMarketChangePercent: Number(supabaseData.pre_market_change_percent || 0),
		preMarketTime:
			(supabaseData.pre_market_time as string) || new Date().toISOString(),
		postMarketPrice: Number(supabaseData.post_market_price || 0),
		postMarketChange: Number(supabaseData.post_market_change || 0),
		postMarketChangePercent: Number(
			supabaseData.post_market_change_percent || 0,
		),
		postMarketTime:
			(supabaseData.post_market_time as string) || new Date().toISOString(),
	};
}

// Helper function to convert Yahoo Finance quote to RealtimeStockPrice format
function convertYahooToRealtimePrice(
	quote: YahooQuoteResponse,
	ticker: string,
): RealtimeStockPrice {
	return {
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

// Helper function to get Yahoo Finance ticker format
function getYahooTicker(ticker: string): string {
	const upperTicker = ticker.toUpperCase();
	return upperTicker === "ETHUSD"
		? "ETH-USD"
		: upperTicker === "BTCUSD"
			? "BTC-USD"
			: upperTicker;
}

// Main function to fetch realtime stock price data (reads from Supabase only)
// Yahoo Finance is only called by the /update endpoint to avoid rate limiting
async function fetchRealtimeStockPrice(
	ticker: string,
): Promise<RealtimeStockPrice> {
	const upperTicker = ticker.toUpperCase();
	const yahooTicker = getYahooTicker(upperTicker);

	// Get data from Supabase (using public client with RLS)
	const { data: supabaseData, error: supabaseError } = await supabase
		.from("realtime_stock_prices")
		.select("*")
		.eq("ticker", yahooTicker.toUpperCase())
		.single();

	if (supabaseError || !supabaseData) {
		throw new Error(`No data found for ticker ${ticker}`);
	}

	return convertSupabaseToRealtimePrice(supabaseData, upperTicker);
}

// Track if an update is already running
let isUpdateRunning = false;
let updateStartTime: Date | null = null;
let updateTickers: string[] = [];

// Background update processor
async function processTickerUpdates(tickerList: string[]): Promise<void> {
	isUpdateRunning = true;
	updateStartTime = new Date();
	updateTickers = tickerList;
	console.log(`Starting background update for ${tickerList.length} tickers`);

	for (const ticker of tickerList) {
		const yahooTicker = getYahooTicker(ticker);
		const isCrypto = isCryptoTicker(ticker);

		try {
			let price: number | null = null;
			let currency = "USD";
			let exchangeName = "";
			let tradeTime: string | null = null;
			let source: "marketstack" | "yahoo" = "marketstack";

			// Try Marketstack first for non-crypto tickers
			if (!isCrypto) {
				const marketstackData = await fetchFromMarketstack(ticker);
				if (marketstackData) {
					price = marketstackData.price;
					currency = marketstackData.currency || "USD";
					exchangeName = marketstackData.exchange_name || "";
					tradeTime = marketstackData.trade_last || null;
				}
			}

			// Fall back to Yahoo Finance if Marketstack fails or for crypto
			let quote: YahooQuoteResponse | null = null;
			if (price === null) {
				source = "yahoo";
				console.log(`Using Yahoo Finance for ${ticker}`);
				try {
					quote = (await yahooFinance.quote(yahooTicker)) as YahooQuoteResponse;

					if (quote?.regularMarketPrice) {
						price = quote.regularMarketPrice;
						currency = quote.currency || "USD";
						exchangeName = quote.exchange || "";
					}
				} catch (yahooError) {
					const errorMsg = yahooError instanceof Error ? yahooError.message : String(yahooError);
					const isRateLimit = errorMsg.toLowerCase().includes("too many") ||
						errorMsg.toLowerCase().includes("rate limit") ||
						errorMsg.includes("429");
					if (isRateLimit) {
						console.warn(`Yahoo Finance rate limited for ${ticker}, will try cached data`);
					} else {
						console.warn(`Yahoo Finance error for ${ticker}:`, errorMsg);
					}
				}
			}

			// Fall back to latest price from stock_prices table (historical data)
			if (price === null) {
				console.log(`Using cached stock_prices for ${ticker}`);

				// First get company_id from companies table
				const { data: company } = await supabaseServiceRole
					.from("companies")
					.select("id")
					.eq("ticker", ticker.toUpperCase())
					.single();

				if (company?.id) {
					const { data: stockPriceData } = await supabaseServiceRole
						.from("stock_prices")
						.select("close, date")
						.eq("company_id", company.id)
						.order("date", { ascending: false })
						.limit(1)
						.single();

					if (stockPriceData?.close) {
						price = stockPriceData.close;
						source = "cached" as "marketstack" | "yahoo";
						console.log(`Using cached price ${price} from ${stockPriceData.date} for ${ticker}`);
					}
				}
			}

			if (price === null) {
				console.error(`No price data available for ${ticker}`);
				continue;
			}

			// Build upsert data
			const upsertData: Record<string, unknown> = {
				ticker: yahooTicker.toUpperCase(),
				price: price,
				currency: currency,
				regular_market_price: price,
				exchange_name: exchangeName,
				last_updated: new Date().toISOString(),
			};

			// If we have Yahoo quote data, include extended fields
			if (quote) {
				Object.assign(upsertData, {
					regular_market_change: quote.regularMarketChange || 0,
					regular_market_change_percent: quote.regularMarketChangePercent || 0,
					regular_market_time:
						quote.regularMarketTime && typeof quote.regularMarketTime === "number"
							? new Date(quote.regularMarketTime * 1000).toISOString()
							: new Date().toISOString(),
					regular_market_previous_close: quote.regularMarketPreviousClose || 0,
					regular_market_open: quote.regularMarketOpen || 0,
					regular_market_day_low: quote.regularMarketDayLow || 0,
					regular_market_day_high: quote.regularMarketDayHigh || 0,
					regular_market_volume: quote.regularMarketVolume || 0,
					market_state: quote.marketState || "UNKNOWN",
					full_exchange_name: quote.fullExchangeName || "",
					display_name: quote.displayName || ticker.toUpperCase(),
					long_name: quote.longName || ticker.toUpperCase(),
					pre_market_price: quote.preMarketPrice || 0,
					pre_market_change: quote.preMarketChange || 0,
					pre_market_change_percent: quote.preMarketChangePercent || 0,
					pre_market_time:
						quote.preMarketTime && typeof quote.preMarketTime === "number"
							? new Date(quote.preMarketTime * 1000).toISOString()
							: new Date().toISOString(),
					post_market_price: quote.postMarketPrice || 0,
					post_market_change: quote.postMarketChange || 0,
					post_market_change_percent: quote.postMarketChangePercent || 0,
					post_market_time:
						quote.postMarketTime && typeof quote.postMarketTime === "number"
							? new Date(quote.postMarketTime * 1000).toISOString()
							: new Date().toISOString(),
				});
			} else {
				// Set minimal fields when using Marketstack only
				Object.assign(upsertData, {
					regular_market_time: tradeTime || new Date().toISOString(),
					market_state: "REGULAR",
					display_name: ticker.toUpperCase(),
					long_name: ticker.toUpperCase(),
				});
			}

			// Upsert realtime stock price
			const { error: upsertError } = await supabaseServiceRole
				.from("realtime_stock_prices")
				.upsert(upsertData, { onConflict: "ticker" });

			if (upsertError) {
				console.error(`Database update failed for ${ticker}:`, upsertError.message);
			} else {
				console.log(`Updated ${ticker}: ${price} (${source})`);
			}

			// Add delay between requests to avoid rate limiting
			// 10 seconds for Marketstack, 1 second for Yahoo
			const delayMs = source === "marketstack" ? 10000 : 1000;
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			console.error(`Price fetch error for ${ticker}:`, errorMessage);
		}
	}

	console.log(`Background update completed for ${tickerList.length} tickers`);
	isUpdateRunning = false;
	updateStartTime = null;
	updateTickers = [];
}

// GET /api/stock-prices/realtime/update - Update realtime prices for all tickers (including alternative assets)
// Query params:
//   - tickers: comma-separated list of specific tickers to update (e.g., "SBET,BMNR")
//   - If not provided, updates all tickers from companies table
// Example: /api/stock-prices/realtime/update?tickers=SBET,BMNR (priority tickers only)
// NOTE: This endpoint returns immediately and processes updates in the background
router.get("/update", async (req: Request, res: Response) => {
	try {
		// Check if an update is already running
		if (isUpdateRunning) {
			const elapsed = updateStartTime
				? Math.round((Date.now() - updateStartTime.getTime()) / 1000)
				: 0;
			return res.status(409).json({
				message: "Update already in progress",
				tickers: updateTickers,
				startedAt: updateStartTime?.toISOString(),
				elapsedSeconds: elapsed,
			});
		}

		let tickerList: string[];

		// Check if specific tickers were requested
		const requestedTickers = req.query.tickers as string | undefined;

		if (requestedTickers) {
			// Use specific tickers from query param
			tickerList = requestedTickers
				.split(",")
				.map((t) => t.trim().toUpperCase());
		} else {
			// Get all unique tickers from companies table
			const { data: tickers } = await supabaseServiceRole
				.from("companies")
				.select("ticker")
				.not("ticker", "is", null)
				.not("ticker", "eq", "");
			tickerList = tickers?.map((t) => t.ticker) || [];
		}

		// Start background processing (don't await)
		processTickerUpdates(tickerList).catch((error) => {
			console.error("Background update failed:", error);
		});

		// Return immediately with 202 Accepted
		res.status(202).json({
			message: "Update started in background",
			tickers: tickerList,
			estimatedTime: `${tickerList.length * 10} seconds`,
		});
	} catch (error) {
		console.error("Error starting realtime price update:", error);
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/stock-prices/realtime/cached/:ticker - Cached stock price for specific ticker (15 minutes cache)
router.get("/cached/:ticker", async (req: Request, res: Response) => {
	try {
		const { ticker } = req.params;

		if (!ticker) {
			return res.status(400).json({
				error: "Ticker symbol is required",
			});
		}

		const upperTicker = ticker.toUpperCase();
		const now = Date.now();
		const cacheKey = upperTicker;

		// Check if we have valid cached data
		const cachedEntry = priceCache.get(cacheKey);
		const isCacheValid =
			cachedEntry && now - cachedEntry.timestamp < CACHE_DURATION_MS;

		let realtimeData: RealtimeStockPrice;
		let isFromCache = false;
		let cacheTimestamp = now;

		if (isCacheValid && cachedEntry) {
			// Use cached data
			realtimeData = cachedEntry.data;
			isFromCache = true;
			cacheTimestamp = cachedEntry.timestamp;
		} else {
			// Fetch fresh data using the shared function
			try {
				realtimeData = await fetchRealtimeStockPrice(ticker);

				// Cache the fresh data
				priceCache.set(cacheKey, {
					data: realtimeData,
					timestamp: now,
				});
				cacheTimestamp = now;
			} catch (error) {
				if (error instanceof Error && error.message.includes("No data found")) {
					return res.status(404).json({
						error: error.message,
					});
				}
				throw error; // Re-throw other errors to be caught by outer catch block
			}
		}

		// Calculate cache timing information
		const expiresAt = cacheTimestamp + CACHE_DURATION_MS;
		const timeToRefreshMs = Math.max(0, expiresAt - now);
		const timeToRefreshMinutes =
			Math.round((timeToRefreshMs / (60 * 1000)) * 100) / 100;

		// Create response with cache information
		const cachedRealtimeData: CachedRealtimeStockPrice = {
			...realtimeData,
			cache: {
				cachedAt: new Date(cacheTimestamp).toISOString(),
				expiresAt: new Date(expiresAt).toISOString(),
				timeToRefreshMs,
				timeToRefreshMinutes,
				isFromCache,
			},
		};

		const response: ApiResponse<CachedRealtimeStockPrice> = {
			data: cachedRealtimeData,
		};

		// Add cache headers (cache for 15 minutes, but allow stale responses)
		res.set({
			"Cache-Control": "public, max-age=900, stale-while-revalidate=300", // 15 minutes cache, 5 minutes stale
		});

		res.json(response);
	} catch (error) {
		console.error("Error fetching cached real-time stock price:", error);

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
			if (error.message.includes("Rate limited")) {
				return res.status(429).json({
					error: error.message,
				});
			}
		}

		res.status(500).json(handleDbError(error));
	}
});

// GET /api/stock-prices/realtime/:ticker - Real-time stock price for specific ticker
router.get("/:ticker", async (req: Request, res: Response) => {
	try {
		const { ticker } = req.params;

		if (!ticker) {
			return res.status(400).json({
				error: "Ticker symbol is required",
			});
		}

		// Fetch realtime data using the shared function
		const realtimeData = await fetchRealtimeStockPrice(ticker);

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

		// Handle specific errors
		if (error instanceof Error) {
			if (error.message.includes("No data found")) {
				return res.status(404).json({
					error: error.message,
				});
			}
			if (
				error.message.includes("Not Found") ||
				error.message.includes("404")
			) {
				return res.status(404).json({
					error: `Ticker ${req.params.ticker} not found`,
				});
			}
			if (error.message.includes("Rate limited")) {
				return res.status(429).json({
					error: error.message,
				});
			}
		}

		res.status(500).json(handleDbError(error));
	}
});

export default router;
