import { type Request, type Response, Router } from "express";
import {
	CacheDuration,
	EndpointCache,
	createCacheManagementRoutes,
	createCacheMiddleware,
} from "../lib/cache";
import { handleDbError, supabase } from "../lib/supabase";
import type { ApiResponse, Company, CompanyWithData } from "../types";

const router: Router = Router();

// Create cache instance for companies with 1 hour TTL
const companiesCache = new EndpointCache<Company[]>({
	ttlMs: CacheDuration.HOUR,
	keyPrefix: "companies",
});

// Data fetcher function for companies
async function fetchCompanies(): Promise<Company[]> {
	const { data: companies, error } = await supabase
		.from("companies")
		.select("*")
		.order("name");

	if (error) {
		throw error;
	}

	return companies || [];
}

// Cache management routes
const cacheManagement = createCacheManagementRoutes(companiesCache);

// GET /api/companies - Get all companies (with 1-hour caching)
router.get("/", createCacheMiddleware(companiesCache, fetchCompanies));

// GET /api/companies/ticker/:ticker - Get company by ticker with optional related data
router.get("/ticker/:ticker", async (req: Request, res: Response) => {
	try {
		const { ticker } = req.params;
		const { include } = req.query;

		// Base company query by ticker
		const { data: company, error: companyError } = await supabase
			.from("companies")
			.select("*")
			.eq("ticker", ticker.toUpperCase())
			.single();

		if (companyError) {
			return res.status(500).json(handleDbError(companyError));
		}

		if (!company) {
			return res.status(404).json({ error: "Company not found" });
		}

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

		const response: ApiResponse<CompanyWithData> = {
			data: result,
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

// Cache management endpoints
router.get("/cache/info", cacheManagement.info);
router.delete("/cache/clear", cacheManagement.clear);

export default router;
