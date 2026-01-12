import WebSocket from "ws";
import { supabaseServiceRole } from "../lib/supabase";

// Finazon API configuration
const FINAZON_API_KEY = process.env.FINAZON_API_KEY;
const FINAZON_WS_URL = `wss://ws.finazon.io/v1?apikey=${FINAZON_API_KEY}`;

// Hardcoded symbols for initial testing
const STOCK_SYMBOLS = ["BMNR"];

// WebSocket connection state
let ws: WebSocket | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_BASE_DELAY_MS = 1000;

// Heartbeat interval
let heartbeatInterval: NodeJS.Timeout | null = null;
const HEARTBEAT_INTERVAL_MS = 30000; // Send heartbeat every 30 seconds

interface FinazonBarMessage {
	d: string; // Dataset
	s: string; // Symbol
	t: number; // Timestamp (unix seconds)
	o: number; // Open
	h: number; // High
	l: number; // Low
	c: number; // Close (current price)
	v: number; // Volume
}

interface FinazonEventMessage {
	event?: string;
	status?: string;
	message?: string;
	request_id?: number;
}

type FinazonMessage = FinazonBarMessage | FinazonEventMessage;

// Update price directly - no debounce needed, Finazon sends every 10s
async function updatePrice(ticker: string, price: number): Promise<void> {
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
				{ onConflict: "ticker" },
			);

		if (error) {
			console.error(`[Finazon WS] Failed to update ${ticker}:`, error.message);
		}
	} catch (err) {
		console.error(`[Finazon WS] Error updating ${ticker}:`, err);
	}
}

function isBarMessage(msg: FinazonMessage): msg is FinazonBarMessage {
	return "s" in msg && "c" in msg && "t" in msg;
}

function handleMessage(data: WebSocket.Data): void {
	try {
		const raw = data.toString();
		console.log(raw);
		const message: FinazonMessage = JSON.parse(raw);

		// Handle event messages (subscriptions, errors, heartbeat responses)
		if ("event" in message || "status" in message) {
			const eventMsg = message as FinazonEventMessage;
			if (eventMsg.status === "error") {
				console.error(`[Finazon WS] Error:`, eventMsg.message);
			} else if (eventMsg.event === "subscribed") {
				console.log(`[Finazon WS] Subscription confirmed`);
			}
			return;
		}

		// Handle bar/price data
		if (isBarMessage(message)) {
			const ticker = message.s.toUpperCase();
			const price = message.c; // Use close price as current price
			console.log(`[Finazon WS] ${ticker}: $${price}`);
			updatePrice(ticker, price);
		}
	} catch (err) {
		console.error("[Finazon WS] Failed to parse message:", err);
	}
}

function subscribe(socket: WebSocket): void {
	// Subscribe to stock symbols using Finazon format
	// frequency: "10s" means Finazon sends updates every 10 seconds
	const subscribeMessage = {
		event: "subscribe",
		dataset: "us_stocks_essential",
		tickers: STOCK_SYMBOLS,
		channel: "bars",
		frequency: "10s",
		aggregation: "1m",
		request_id: 1,
	};

	socket.send(JSON.stringify(subscribeMessage));
	console.log(`[Finazon WS] Subscribed to: ${STOCK_SYMBOLS.join(", ")}`);
}

function sendHeartbeat(): void {
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ event: "heartbeat", request_id: Date.now() }));
	}
}

function startHeartbeat(): void {
	stopHeartbeat();
	heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
	if (heartbeatInterval) {
		clearInterval(heartbeatInterval);
		heartbeatInterval = null;
	}
}

function connect(): void {
	if (!FINAZON_API_KEY) {
		console.error(
			"[Finazon WS] FINAZON_API_KEY not set, skipping WebSocket connection",
		);
		return;
	}

	console.log("[Finazon WS] Connecting...");

	ws = new WebSocket(FINAZON_WS_URL);

	ws.on("open", () => {
		console.log("[Finazon WS] Connected!");
		reconnectAttempts = 0;
		subscribe(ws!);
		startHeartbeat();
	});

	ws.on("message", handleMessage);

	ws.on("close", (code, reason) => {
		console.log(
			`[Finazon WS] Disconnected (code: ${code}, reason: ${reason.toString()})`,
		);
		ws = null;
		stopHeartbeat();
		scheduleReconnect();
	});

	ws.on("error", (error) => {
		console.error("[Finazon WS] Error:", error.message);
	});
}

function scheduleReconnect(): void {
	if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
		console.error("[Finazon WS] Max reconnect attempts reached. Giving up.");
		return;
	}

	const delay = RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts;
	reconnectAttempts++;

	console.log(
		`[Finazon WS] Reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`,
	);

	setTimeout(() => {
		connect();
	}, delay);
}

export function startFinazonWebSocket(): void {
	console.log("[Finazon WS] Starting Finazon WebSocket service...");
	console.log(`[Finazon WS] Stocks: ${STOCK_SYMBOLS.join(", ")}`);

	connect();
}

export function stopFinazonWebSocket(): void {
	console.log("[Finazon WS] Stopping Finazon WebSocket service...");

	stopHeartbeat();

	if (ws) {
		ws.close();
		ws = null;
	}
}

export function getFinazonStatus(): {
	connected: boolean;
	symbols: string[];
	reconnectAttempts: number;
} {
	return {
		connected: ws?.readyState === WebSocket.OPEN,
		symbols: STOCK_SYMBOLS,
		reconnectAttempts,
	};
}
