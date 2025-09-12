import { type Request, type Response, Router } from "express";
import { handleDbError, supabase } from "../lib/supabase";
import type { ApiResponse, Company, CompanyWithData } from "../types";

const router: Router = Router();

// GET /api/companies - Get all companies
router.get("/", async (req: Request, res: Response) => {
	try {
		const { data: companies, error } = await supabase
			.from("companies")
			.select("*")
			.order("name");

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		const response: ApiResponse<Company[]> = {
			data: companies || [],
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

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

export default router;
