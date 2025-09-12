import { type Request, type Response, Router } from "express";
import { handleDbError, supabaseServiceRole as supabase } from "../lib/supabase";
import type { ApiResponse, MoonshotTransaction } from "../types";

const router: Router = Router();

// GET /api/moonshot-transactions - Get transactions with filtering
router.get("/", async (req: Request, res: Response) => {
	try {
		const { investment_id, transaction_type, from_date, to_date, limit } = req.query;

		let query = supabase.from("moonshot_transactions").select(`
			*,
			moonshot_investments!inner(
				ticker,
				company_name,
				companies!inner(name)
			)
		`);

		// Filter by investment
		if (investment_id) {
			query = query.eq("investment_id", investment_id as string);
		}

		// Filter by transaction type
		if (transaction_type) {
			query = query.eq("transaction_type", transaction_type as string);
		}

		// Filter by date range
		if (from_date) {
			query = query.gte("transaction_date", from_date as string);
		}
		if (to_date) {
			query = query.lte("transaction_date", to_date as string);
		}

		// Limit results
		if (limit) {
			query = query.limit(Number.parseInt(limit as string));
		}

		// Order by date (most recent first)
		query = query.order("transaction_date", { ascending: false });

		const { data, error } = await query;

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		const response: ApiResponse<MoonshotTransaction[]> = {
			data: data || [],
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

// POST /api/moonshot-transactions - Create new transaction (buy/sell)
router.post("/", async (req: Request, res: Response) => {
	try {
		const {
			investment_id,
			transaction_type,
			transaction_date,
			shares,
			price_per_share,
			fees,
			notes,
		} = req.body;

		// Validate required fields
		if (!investment_id || !transaction_type || !transaction_date || !shares || !price_per_share) {
			return res.status(400).json({
				error: "Missing required fields",
				message: "investment_id, transaction_type, transaction_date, shares, and price_per_share are required",
			});
		}

		// Validate transaction type
		if (!["buy", "sell"].includes(transaction_type)) {
			return res.status(400).json({
				error: "Invalid transaction_type",
				message: "transaction_type must be 'buy' or 'sell'",
			});
		}

		// Validate numeric fields
		if (shares <= 0 || price_per_share <= 0) {
			return res.status(400).json({
				error: "Invalid numeric values",
				message: "shares and price_per_share must be positive numbers",
			});
		}

		// Verify investment exists and get current shares_remaining
		const { data: investment, error: investmentError } = await supabase
			.from("moonshot_investments")
			.select("shares_remaining, shares_purchased")
			.eq("id", investment_id)
			.single();

		if (investmentError) {
			return res.status(400).json({
				error: "Invalid investment_id",
				message: "Investment not found",
			});
		}

		// For sell transactions, validate sufficient shares
		if (transaction_type === "sell" && shares > investment.shares_remaining) {
			return res.status(400).json({
				error: "Insufficient shares",
				message: `Cannot sell ${shares} shares. Only ${investment.shares_remaining} shares remaining.`,
			});
		}

		// Calculate total amount
		const total_amount = shares * price_per_share + (fees || 0);

		// Start a database transaction
		const { data: transaction, error } = await supabase.rpc('create_moonshot_transaction', {
			p_investment_id: investment_id,
			p_transaction_type: transaction_type,
			p_transaction_date: transaction_date,
			p_shares: shares,
			p_price_per_share: price_per_share,
			p_total_amount: total_amount,
			p_fees: fees || 0,
			p_notes: notes || null,
		});

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		// Fetch the created transaction with related data
		const { data: createdTransaction, error: fetchError } = await supabase
			.from("moonshot_transactions")
			.select(`
				*,
				moonshot_investments!inner(
					ticker,
					company_name,
					companies!inner(name)
				)
			`)
			.eq("id", transaction[0].id)
			.single();

		if (fetchError) {
			return res.status(500).json(handleDbError(fetchError));
		}

		const response: ApiResponse<MoonshotTransaction> = {
			data: createdTransaction,
			message: `${transaction_type === "buy" ? "Purchase" : "Sale"} transaction recorded successfully`,
		};

		res.status(201).json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

// GET /api/moonshot-transactions/:investment_id - Get transactions for specific investment
router.get("/:investment_id", async (req: Request, res: Response) => {
	try {
		const { investment_id } = req.params;
		const { limit } = req.query;

		let query = supabase
			.from("moonshot_transactions")
			.select(`
				*,
				moonshot_investments!inner(
					ticker,
					company_name,
					companies!inner(name)
				)
			`)
			.eq("investment_id", investment_id)
			.order("transaction_date", { ascending: false });

		// Limit results
		if (limit) {
			query = query.limit(Number.parseInt(limit as string));
		}

		const { data, error } = await query;

		if (error) {
			return res.status(500).json(handleDbError(error));
		}

		const response: ApiResponse<MoonshotTransaction[]> = {
			data: data || [],
		};

		res.json(response);
	} catch (error) {
		res.status(500).json(handleDbError(error));
	}
});

export default router;