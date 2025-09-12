import { type Request, type Response, Router } from "express";
import { handleDbError, supabase } from "../lib/supabase";
import type { ApiResponse, CompanyMetrics } from "../types";

const router: Router = Router();

// GET /api/company-metrics - Get company metrics with filtering
router.get("/", async (req: Request, res: Response) => {
	try {
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

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		const response: ApiResponse<CompanyMetrics[]> = {
			data: data || [],
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

export default router;
