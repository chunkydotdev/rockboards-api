import { type Request, type Response, Router } from "express";
import { handleDbError, supabase } from "../lib/supabase";
import type { ApiResponse, StockPrice } from "../types";

const router: Router = Router();

// GET /api/stock-prices - Historical stock prices
router.get("/", async (req: Request, res: Response) => {
	try {
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

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		const response: ApiResponse<StockPrice[]> = {
			data: prices || [],
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

export default router;
