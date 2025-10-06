import { type Request, Router } from "express";
import {
	CacheDuration,
	EndpointCache,
	createCacheManagementRoutes,
	createCacheMiddleware,
} from "../lib/cache";
import { supabase } from "../lib/supabase";
import type { Company, CompanyWithData } from "../types";

const router: Router = Router();

// Create cache instance for companies list - 1 hour TTL (companies rarely change)
const companiesListCache = new EndpointCache<Company[]>({
	ttlMs: CacheDuration.HOUR,
	keyPrefix: "companies_list",
});

// Create cache instance for company by ticker - 10 minutes TTL
const companyByTickerCache = new EndpointCache<CompanyWithData>({
	ttlMs: CacheDuration.MINUTES(10),
	keyPrefix: "company_by_ticker",
	generateKey: (req) => {
		const ticker = req.params.ticker?.toUpperCase() || "";
		const include = req.query.include || "";
		return `company:${ticker}:include:${include}`;
	},
});

// Data fetcher for companies list
async function fetchCompaniesList(req: Request): Promise<Company[]> {
	const { data: companies, error } = await supabase
		.from("companies")
		.select("*")
		.order("name");

	if (error) throw error;
	return companies || [];
}

// Data fetcher for company by ticker
async function fetchCompanyByTicker(req: Request): Promise<CompanyWithData> {
	const { ticker } = req.params;
	const { include } = req.query;

	// Base company query by ticker
	const { data: company, error: companyError } = await supabase
		.from("companies")
		.select("*")
		.eq("ticker", ticker.toUpperCase())
		.single();

	if (companyError) throw companyError;
	if (!company) throw new Error("Company not found");

	const result: CompanyWithData = { ...company };

	// Include related data based on query parameter
	if (include) {
		const includes = (include as string).split(",");

		if (includes.includes("company_metrics")) {
			const { data: companyMetrics } = await supabase
				.from("company_metrics")
				.select("*")
				.eq("company_id", company.id)
				.order("date", { ascending: false });
			result.company_metrics = companyMetrics || [];
		}

		if (includes.includes("stock_prices")) {
			const { data: stockPrices } = await supabase
				.from("stock_prices")
				.select("*")
				.eq("company_id", company.id)
				.order("date", { ascending: false });
			result.stock_prices = stockPrices || [];
		}

		if (includes.includes("events")) {
			const { data: events } = await supabase
				.from("events")
				.select("*")
				.eq("company_id", company.id)
				.order("date", { ascending: false });
			result.events = events || [];
		}
	}

	return result;
}

// Cache management routes
const listCacheManagement = createCacheManagementRoutes(companiesListCache);
const tickerCacheManagement = createCacheManagementRoutes(companyByTickerCache);

// GET /api/companies - Get all companies (with automatic caching!)
router.get("/", createCacheMiddleware(companiesListCache, fetchCompaniesList));

// GET /api/companies/ticker/:ticker - Get company by ticker with optional related data (with automatic caching!)
router.get(
	"/ticker/:ticker",
	createCacheMiddleware(companyByTickerCache, fetchCompanyByTicker),
);

// Cache management endpoints
router.get("/cache/list/info", listCacheManagement.info);
router.delete("/cache/list/clear", listCacheManagement.clear);
router.get("/cache/ticker/info", tickerCacheManagement.info);
router.delete("/cache/ticker/clear", tickerCacheManagement.clear);

export default router;
