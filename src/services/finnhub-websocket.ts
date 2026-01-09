import WebSocket from "ws";
import { supabaseServiceRole } from "../lib/supabase";

// Finnhub API configuration
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const FINNHUB_WS_URL = `wss://ws.finnhub.io?token=${FINNHUB_API_KEY}`;

// Hardcoded symbols for initial testing
const STOCK_SYMBOLS = ["BMNR", "ORBS", "SBET"];
const CRYPTO_SYMBOLS = [
	{ finnhub: "BINANCE:BTCUSDT", ticker: "BTC-USD" },
	{ finnhub: "BINANCE:ETHUSDT", ticker: "ETH-USD" },
];

// Debounce configuration - max one update per symbol per 15 seconds
const DEBOUNCE_MS = 15000;
const lastUpdateTime = new Map<string, number>();
const pendingPrices = new Map<string, number>();

// WebSocket connection state
let ws: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 1000;

interface FinnhubTrade {
	s: string; // Symbol
	p: number; // Price
	t: number; // Timestamp (unix ms)
	v: number; // Volume
}

interface FinnhubMessage {
	type: "trade" | "ping" | "error";
	data?: FinnhubTrade[];
	msg?: string;
}

// Map Finnhub symbol to our ticker format
function mapToTicker(finnhubSymbol: string): string {
	// Check crypto mapping first
	const crypto = CRYPTO_SYMBOLS.find((c) => c.finnhub === finnhubSymbol);
	if (crypto) {
		return crypto.ticker;
	}
	// Stock symbols are used as-is
	return finnhubSymbol.toUpperCase();
}

// Debounced update to Supabase
async function updatePrice(ticker: string, price: number): Promise<void> {
	const now = Date.now();
	const lastUpdate = lastUpdateTime.get(ticker) || 0;

	// Store the latest price
	pendingPrices.set(ticker, price);

	// Check if we should update now
	if (now - lastUpdate < DEBOUNCE_MS) {
		return; // Skip, will be updated by next trade or scheduled flush
	}

	// Update now
	await flushPrice(ticker);
}

async function flushPrice(ticker: string): Promise<void> {
	const price = pendingPrices.get(ticker);
	if (price === undefined) return;

	lastUpdateTime.set(ticker, Date.now());
	pendingPrices.delete(ticker);

	try {
		const { error } = await supabaseServiceRole
			.from("realtime_stock_prices")
			.upsert(
				{
					ticker: ticker,
					price: price,
					regular_market_price: price,
					currency: "USD",
					last_updated: new Date().toISOString(),
					market_state: "REGULAR",
				},
				{ onConflict: "ticker" }
			);

		if (error) {
			console.error(`[Finnhub WS] Failed to update ${ticker}:`, error.message);
		} else {
			console.log(`[Finnhub WS] Updated ${ticker}: $${price.toFixed(2)}`);
		}
	} catch (err) {
		console.error(`[Finnhub WS] Error updating ${ticker}:`, err);
	}
}

// Flush all pending prices periodically
async function flushAllPendingPrices(): Promise<void> {
	const tickers = Array.from(pendingPrices.keys());
	for (const ticker of tickers) {
		await flushPrice(ticker);
	}
}

function handleMessage(data: WebSocket.Data): void {
	try {
		const raw = data.toString();

		// Don't log ping messages to reduce noise
		if (!raw.includes('"type":"ping"')) {
			console.log(`[Finnhub WS] Raw message: ${raw}`);
		}

		const message: FinnhubMessage = JSON.parse(raw);

		if (message.type === "ping") {
			return;
		}

		if (message.type === "error") {
			console.error(`[Finnhub WS] Error:`, message.msg);
			return;
		}

		if (message.type === "trade" && message.data) {
			for (const trade of message.data) {
				const ticker = mapToTicker(trade.s);
				updatePrice(ticker, trade.p);
			}
		}
	} catch (err) {
		console.error("[Finnhub WS] Failed to parse message:", err);
	}
}

function subscribe(socket: WebSocket): void {
	// Subscribe to stock symbols
	for (const symbol of STOCK_SYMBOLS) {
		socket.send(JSON.stringify({ type: "subscribe", symbol }));
		console.log(`[Finnhub WS] Subscribed to ${symbol}`);
	}

	// Subscribe to crypto symbols
	for (const crypto of CRYPTO_SYMBOLS) {
		socket.send(JSON.stringify({ type: "subscribe", symbol: crypto.finnhub }));
		console.log(`[Finnhub WS] Subscribed to ${crypto.finnhub} -> ${crypto.ticker}`);
	}
}

function connect(): void {
	if (!FINNHUB_API_KEY) {
		console.error("[Finnhub WS] FINNHUB_API_KEY not set, skipping WebSocket connection");
		return;
	}

	console.log("[Finnhub WS] Connecting...");

	ws = new WebSocket(FINNHUB_WS_URL);

	ws.on("open", () => {
		console.log("[Finnhub WS] Connected!");
		reconnectAttempts = 0;
		subscribe(ws!);
	});

	ws.on("message", handleMessage);

	ws.on("close", (code, reason) => {
		console.log(`[Finnhub WS] Disconnected (code: ${code}, reason: ${reason.toString()})`);
		ws = null;
		scheduleReconnect();
	});

	ws.on("error", (error) => {
		console.error("[Finnhub WS] Error:", error.message);
	});
}

function scheduleReconnect(): void {
	if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
		console.error("[Finnhub WS] Max reconnect attempts reached. Giving up.");
		return;
	}

	const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
	reconnectAttempts++;

	console.log(`[Finnhub WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

	setTimeout(() => {
		connect();
	}, delay);
}

// Periodic flush of pending prices (every second)
let flushInterval: NodeJS.Timeout | null = null;

export function startFinnhubWebSocket(): void {
	console.log("[Finnhub WS] Starting Finnhub WebSocket service...");
	console.log(`[Finnhub WS] Stocks: ${STOCK_SYMBOLS.join(", ")}`);
	console.log(`[Finnhub WS] Crypto: ${CRYPTO_SYMBOLS.map((c) => c.ticker).join(", ")}`);

	connect();

	// Start periodic flush
	flushInterval = setInterval(() => {
		flushAllPendingPrices();
	}, DEBOUNCE_MS);
}

export function stopFinnhubWebSocket(): void {
	console.log("[Finnhub WS] Stopping Finnhub WebSocket service...");

	if (flushInterval) {
		clearInterval(flushInterval);
		flushInterval = null;
	}

	if (ws) {
		ws.close();
		ws = null;
	}
}

export function getFinnhubStatus(): {
	connected: boolean;
	symbols: string[];
	reconnectAttempts: number;
} {
	return {
		connected: ws?.readyState === WebSocket.OPEN,
		symbols: [...STOCK_SYMBOLS, ...CRYPTO_SYMBOLS.map((c) => c.ticker)],
		reconnectAttempts,
	};
}
