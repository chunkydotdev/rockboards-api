import { type Request, Router } from "express";
import {
	CacheDuration,
	EndpointCache,
	createCacheManagementRoutes,
	createCacheMiddleware,
} from "../lib/cache";
import { supabase } from "../lib/supabase";
import type { StockPrice } from "../types";

const router: Router = Router();

// Create cache instance - 1 hour TTL with smart key generation
const stockPriceCache = new EndpointCache<StockPrice[]>({
	ttlMs: CacheDuration.HOUR,
	keyPrefix: "stock_prices",
	generateKey: (req) => {
		const { company_id, ticker, from_date, to_date, limit } = req.query;
		const keyParts = [
			company_id ? `company_id:${company_id}` : "",
			ticker ? `ticker:${(ticker as string).toUpperCase()}` : "",
			from_date ? `from:${from_date}` : "",
			to_date ? `to:${to_date}` : "",
			limit ? `limit:${limit}` : "",
		].filter(Boolean);
		return `stock_prices:${keyParts.join("|")}`;
	},
});

// Data fetcher function
async function fetchStockPrices(req: Request): Promise<StockPrice[]> {
	const { company_id, ticker, from_date, to_date, limit } = req.query;

	let query = supabase.from("stock_prices").select(`
        *,
        companies!inner(id, name, ticker)
      `);

	// Apply filters
	if (company_id) {
		query = query.eq("company_id", company_id as string);
	}
	if (ticker) {
		query = query.eq("companies.ticker", (ticker as string).toUpperCase());
	}
	if (from_date) {
		query = query.gte("date", from_date as string);
	}
	if (to_date) {
		query = query.lte("date", to_date as string);
	}

	// Apply limit and ordering
	query = query.order("date", { ascending: false });
	if (limit) {
		query = query.limit(Number.parseInt(limit as string, 10));
	}

	const { data: prices, error } = await query;
	if (error) throw error;
	return prices || [];
}

// Cache management routes
const cacheManagement = createCacheManagementRoutes(stockPriceCache);

// GET /api/stock-prices - Historical stock prices (with automatic caching!)
router.get("/", createCacheMiddleware(stockPriceCache, fetchStockPrices));

// Cache management endpoints
router.get("/cache/info", cacheManagement.info);
router.delete("/cache/clear", cacheManagement.clear);

export default router;
