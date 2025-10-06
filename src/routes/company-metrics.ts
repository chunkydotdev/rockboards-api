import { type Request, Router } from "express";
import {
	CacheDuration,
	EndpointCache,
	createCacheManagementRoutes,
	createCacheMiddleware,
} from "../lib/cache";
import { supabase } from "../lib/supabase";
import type { CompanyMetrics } from "../types";

const router: Router = Router();

// Create cache instance - 10 minutes TTL with smart key generation
const companyMetricsCache = new EndpointCache<CompanyMetrics[]>({
	ttlMs: CacheDuration.MINUTES(10),
	keyPrefix: "company_metrics",
	generateKey: (req) => {
		const { company_id, ticker, from_date, to_date, limit } = req.query;
		const keyParts = [
			company_id ? `company_id:${company_id}` : "",
			ticker ? `ticker:${(ticker as string).toUpperCase()}` : "",
			from_date ? `from:${from_date}` : "",
			to_date ? `to:${to_date}` : "",
			limit ? `limit:${limit}` : "",
		].filter(Boolean);
		return `company_metrics:${keyParts.join("|")}`;
	},
});

// Data fetcher function
async function fetchCompanyMetrics(req: Request): Promise<CompanyMetrics[]> {
	const { company_id, ticker, from_date, to_date, limit } = req.query;

	let query = supabase.from("company_metrics").select(`
		*,
		companies!inner(ticker, name)
	`);

	// Filter by company
	if (company_id) {
		query = query.eq("company_id", company_id as string);
	} else if (ticker) {
		query = query.eq("companies.ticker", (ticker as string).toUpperCase());
	}

	// Filter by date range
	if (from_date) {
		query = query.gte("date", from_date as string);
	}
	if (to_date) {
		query = query.lte("date", to_date as string);
	}

	// Limit results
	if (limit) {
		query = query.limit(Number.parseInt(limit as string));
	}

	// Order by date (most recent first)
	query = query.order("date", { ascending: false });

	const { data, error } = await query;
	if (error) throw error;
	return data || [];
}

// Cache management routes
const cacheManagement = createCacheManagementRoutes(companyMetricsCache);

// GET /api/company-metrics - Get company metrics with filtering (with automatic caching!)
router.get(
	"/",
	createCacheMiddleware(companyMetricsCache, fetchCompanyMetrics),
);

// Cache management endpoints
router.get("/cache/info", cacheManagement.info);
router.delete("/cache/clear", cacheManagement.clear);

export default router;
