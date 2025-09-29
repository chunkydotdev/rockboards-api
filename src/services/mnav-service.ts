import { supabaseServiceRole } from "../lib/supabase";

// Database types - matching frontend types
interface CompanyMetrics {
	id: string;
	company_id: string;
	date: string;
	eth_holdings?: number;
	avg_buy_price?: number;
	usd_holdings?: number;
	staking_rewards?: number;
	shares_outstanding?: number;
	market_cap?: number;
	eth_concentration?: number;
	issued_atm_shares?: number;
	notes?: string;
}

interface StockPrice {
	id: string;
	company_id: string;
	date: string;
	open?: number;
	high?: number;
	low?: number;
	close?: number;
	volume?: number;
}

interface CompanyMetric {
	companyId: string;
	date: string;
	ethHoldings: number;
	avgBuyPrice: number;
	usdHoldings: number;
	stakingRewards: number;
	sharesOutstanding: number;
	marketCap: number;
	ethConcentration: number;
	issuedAtmShares: number;
	weightedAvgBuyPrice: number;
	notes: string;
	sharesBoughtBack?: number;
}

interface NavMetric {
	companyId: string;
	date: string;
	navPerShare: number;
	stockPrice: number;
	ethPrice: number;
	mNav: number;
	totalNavValue: number;
}

interface AlternativeAsset {
	shares_remaining: number;
	current_price: number;
}

interface AlternativeAssetsPortfolio {
	totalCurrentValue: number;
}

// Utility functions
function normalizeDate(dateStr: string): string {
	const date = new Date(dateStr);
	return `${date.toISOString().split("T")[0]}T00:00:00.000Z`;
}

function addDays(date: Date, days: number): Date {
	const result = new Date(date);
	result.setDate(result.getDate() + days);
	return result;
}

function differenceInDays(date1: Date, date2: Date): number {
	const timeDiff = date1.getTime() - date2.getTime();
	return Math.ceil(timeDiff / (1000 * 3600 * 24));
}

// Helper function to fetch current ETH price from CoinGecko
export async function getCurrentEthPrice(): Promise<number> {
	try {
		const { data: realtimePrice } = await supabaseServiceRole
			.from("realtime_stock_prices")
			.select("price")
			.eq("ticker", "ETHUSD")
			.single();

		const price = realtimePrice?.price;

		if (price) {
			return price;
		}

		const response = await fetch(
			"https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
		);
		const data = (await response.json()) as { ethereum?: { usd?: number } };
		return data.ethereum?.usd || 0;
	} catch (error) {
		return 0;
	}
}

// Helper function to fetch current BMNR stock price
export async function getCurrentBmnrPrice(): Promise<number> {
	try {
		// Try to get from realtime stock prices table first
		const { data: realtimePrice } = await supabaseServiceRole
			.from("realtime_stock_prices")
			.select("price, pre_market_price, post_market_price")
			.eq("ticker", "BMNR")
			.single();

		const price =
			realtimePrice?.pre_market_price ||
			realtimePrice?.post_market_price ||
			realtimePrice?.price;

		if (price) {
			return price;
		}

		// Fallback to latest stock_prices entry
		const { data: stockPrice } = await supabaseServiceRole
			.from("stock_prices")
			.select("close, date")
			.eq("company_id", "4bf5e88a-dfba-44d0-bdfb-7d878cbd10db") // BMNR company ID
			.order("date", { ascending: false })
			.limit(1)
			.single();

		return stockPrice?.close || 0;
	} catch (error) {
		return 0;
	}
}

// Helper function to get latest company metrics
export async function getLatestCompanyMetrics(
	companyId: string,
): Promise<CompanyMetrics | null> {
	try {
		const { data: metrics, error } = await supabaseServiceRole
			.from("company_metrics")
			.select("*")
			.eq("company_id", companyId)
			.order("date", { ascending: false })
			.limit(1)
			.single();

		if (error) {
			return null;
		}

		return metrics as CompanyMetrics;
	} catch (error) {
		return null;
	}
}

// Helper function to get all company metrics for processing
export async function getAllCompanyMetrics(
	companyId: string,
	fromDate?: string,
): Promise<CompanyMetrics[]> {
	try {
		let query = supabaseServiceRole
			.from("company_metrics")
			.select("*")
			.eq("company_id", companyId)
			.order("date", { ascending: true });

		if (fromDate) {
			query = query.gte("date", fromDate);
		}

		const { data: metrics, error } = await query;

		if (error) {
			return [];
		}

		return (metrics as CompanyMetrics[]) || [];
	} catch (error) {
		return [];
	}
}

// Helper function to get stock prices
export async function getStockPrices(
	companyId: string,
	fromDate?: string,
): Promise<StockPrice[]> {
	try {
		let query = supabaseServiceRole
			.from("stock_prices")
			.select("*")
			.eq("company_id", companyId)
			.order("date", { ascending: true });

		if (fromDate) {
			query = query.gte("date", fromDate);
		}

		const { data: prices, error } = await query;

		if (error) {
			return [];
		}

		return (prices as StockPrice[]) || [];
	} catch (error) {
		return [];
	}
}

// Helper function to get alternative assets current value using the same API as frontend
export async function getAlternativeAssetsValue(
	companyId: string,
): Promise<number> {
	try {
		// Use the same alternative assets API endpoint as frontend
		const response = await fetch(
			`http://localhost:4000/api/alternative-assets?companyId=${companyId}`,
		);

		if (!response.ok) {
			return 0;
		}

		const apiResponse = (await response.json()) as {
			data?: AlternativeAssetsPortfolio;
		};

		if (!apiResponse.data) {
			return 0;
		}

		const totalCurrentValue = apiResponse.data.totalCurrentValue || 0;
		return totalCurrentValue;
	} catch (error) {
		return 0;
	}
}

// Post-fill metrics helper functions
const getLastKnownEthHoldings = (
	metrics: CompanyMetrics[],
	date: Date,
): number | undefined => {
	const currentMetric = metrics.find(
		(metric) => metric.date === date.toISOString(),
	);

	// If current day has eth_holdings, use it
	if (currentMetric?.eth_holdings) {
		return currentMetric.eth_holdings;
	}

	// Otherwise, find the most recent previous metric with eth_holdings
	const sortedMetrics = metrics
		.filter((m) => m.date < date.toISOString() && m.eth_holdings)
		.sort((a, b) => b.date.localeCompare(a.date));

	return sortedMetrics[0]?.eth_holdings;
};

const usdHoldingsExist = (val: number | undefined | null): boolean =>
	val !== undefined && val !== null;

const getLastKnownUsdHoldings = (
	metrics: CompanyMetrics[],
	date: Date,
): number => {
	const currentMetric = metrics.find(
		(metric) => metric.date === date.toISOString(),
	);

	const currentUsdHoldings = currentMetric?.usd_holdings;

	// If current day has usd_holdings, use it
	if (usdHoldingsExist(currentUsdHoldings)) {
		return (currentUsdHoldings || 0) * 1_000_000; // Convert to actual USD value
	}

	// Otherwise, find the most recent previous metric with usd_holdings
	const sortedMetrics = metrics
		.filter(
			(m) => m.date < date.toISOString() && usdHoldingsExist(m.usd_holdings),
		)
		.sort((a, b) => b.date.localeCompare(a.date));

	return (sortedMetrics[0]?.usd_holdings || 0) * 1_000_000; // Convert to actual USD value
};

const getLastKnownAvgBuyPrice = (
	metrics: CompanyMetrics[],
	date: Date,
): number | undefined => {
	const currentMetric = metrics.find(
		(metric) => metric.date === date.toISOString(),
	);

	// If current day has avg_buy_price, use it
	if (currentMetric?.avg_buy_price) {
		return currentMetric.avg_buy_price;
	}

	// Otherwise, find the most recent previous metric with avg_buy_price
	const sortedMetrics = metrics
		.filter((m) => m.date < date.toISOString() && m.avg_buy_price)
		.sort((a, b) => b.date.localeCompare(a.date));

	return sortedMetrics[0]?.avg_buy_price;
};

const getLastKnownStakingRewards = (
	metrics: CompanyMetrics[],
	date: Date,
): number | undefined => {
	const currentMetric = metrics.find(
		(metric) => metric.date === date.toISOString(),
	);

	// If current day has staking_rewards, use it
	if (currentMetric?.staking_rewards) {
		return currentMetric.staking_rewards;
	}

	// Otherwise, find the most recent previous metric with staking_rewards
	const sortedMetrics = metrics
		.filter((m) => m.date < date.toISOString() && m.staking_rewards)
		.sort((a, b) => b.date.localeCompare(a.date));

	return sortedMetrics[0]?.staking_rewards;
};

const getLastKnownEthConcentration = (
	metrics: CompanyMetrics[],
	date: Date,
): number | undefined => {
	const currentMetric = metrics.find(
		(metric) => metric.date === date.toISOString(),
	);

	// If current day has eth_concentration, use it
	if (currentMetric?.eth_concentration) {
		return currentMetric.eth_concentration;
	}

	// Otherwise, find the most recent previous metric with eth_concentration
	const sortedMetrics = metrics
		.filter((m) => m.date < date.toISOString() && m.eth_concentration)
		.sort((a, b) => b.date.localeCompare(a.date));

	return sortedMetrics[0]?.eth_concentration;
};

const getLastKnownSharesOutstanding = (
	companyMetrics: CompanyMetric[],
	date: Date,
): number | undefined => {
	// Find the most recent previous day's shares outstanding from computed results
	const sortedMetrics = companyMetrics
		.filter((m) => m.date < date.toISOString() && m.sharesOutstanding)
		.sort((a, b) => b.date.localeCompare(a.date));

	return sortedMetrics[0]?.sharesOutstanding;
};

const getLastKnownSharesBoughtBack = (
	companyMetrics: CompanyMetric[],
	date: Date,
): number | undefined => {
	// Find the most recent previous day's shares outstanding from computed results
	const sortedMetrics = companyMetrics
		.filter((m) => m.date < date.toISOString() && m.sharesBoughtBack)
		.sort((a, b) => b.date.localeCompare(a.date));

	return sortedMetrics[0]?.sharesBoughtBack;
};

/**
 * Should output company metrics for every day between startDate and today.
 * Days without metrics should be filled with the last known metric or recalculated.
 */
export function postFillMetrics(
	metrics: CompanyMetrics[],
	stockPrices: StockPrice[],
	startDate: string,
): CompanyMetric[] {
	const companyMetrics: CompanyMetric[] = [];

	// Normalize all dates to ISO format before processing
	const normalizedMetrics = metrics.map((metric) => ({
		...metric,
		date: normalizeDate(metric.date),
	}));

	const normalizedStartDate = normalizeDate(startDate);

	const dates = Array.from(
		{ length: differenceInDays(new Date(), new Date(normalizedStartDate)) + 1 },
		(_, i) => addDays(new Date(normalizedStartDate), i),
	).filter((date) => date.getTime() >= new Date(startDate).getTime()); // Changed > to >= to include start date

	// Keep track of last known stock price for post-filling
	let lastKnownStockPrice: number | undefined;

	for (const date of dates) {
		const dateIso = date.toISOString();
		const dateOnly = date.toISOString().split("T")[0]; // Extract just the date part (YYYY-MM-DD)

		// Get stock price for this date, or use last known
		const stockPriceAtClose = stockPrices.find(
			(p) => p.date === dateOnly || p.date === dateIso,
		)?.close;

		if (stockPriceAtClose) {
			lastKnownStockPrice = stockPriceAtClose;
		}

		// Skip if we don't have any stock price data yet
		if (!lastKnownStockPrice) {
			continue;
		}

		// Always try to get last known values for this date
		const lastKnownEthHoldings = getLastKnownEthHoldings(
			normalizedMetrics,
			date,
		);
		const lastKnownUsdHoldings = getLastKnownUsdHoldings(
			normalizedMetrics,
			date,
		);
		const lastKnownAvgBuyPrice = getLastKnownAvgBuyPrice(
			normalizedMetrics,
			date,
		);
		const lastKnownStakingRewards = getLastKnownStakingRewards(
			normalizedMetrics,
			date,
		);
		const lastKnownEthConcentration = getLastKnownEthConcentration(
			normalizedMetrics,
			date,
		);

		// Check if there's any actual metric data available for this date or before it
		const hasAnyMetricData = normalizedMetrics.some(
			(m) =>
				m.date <= dateIso &&
				(m.eth_holdings !== undefined ||
					m.eth_concentration !== undefined ||
					m.avg_buy_price !== undefined ||
					m.usd_holdings !== undefined ||
					m.staking_rewards !== undefined),
		);

		// Skip if we don't have any metric data at all
		if (!hasAnyMetricData) {
			continue;
		}

		const ethConcentration = lastKnownEthConcentration || 0;
		const ethHoldings = lastKnownEthHoldings || 0;
		const sharesOutstanding = ethHoldings / (ethConcentration / 1000);

		const lastKnownSharesOutstanding = getLastKnownSharesOutstanding(
			companyMetrics,
			date,
		);
		const lastKnownSharesBoughtBack = getLastKnownSharesBoughtBack(
			companyMetrics,
			date,
		);

		const issuedAtmShares = lastKnownSharesOutstanding
			? sharesOutstanding - lastKnownSharesOutstanding
			: sharesOutstanding;

		// Find original metric for notes and company_id
		const originalMetric = normalizedMetrics.find(
			(metric) => metric.date === dateIso,
		);
		const companyId =
			originalMetric?.company_id || normalizedMetrics[0]?.company_id;

		if (!companyId) {
			continue; // Skip if we can't determine company ID
		}

		const companyMetric: CompanyMetric = {
			companyId: companyId,
			date: dateIso,
			weightedAvgBuyPrice: lastKnownAvgBuyPrice || 0, // Use avgBuyPrice as weighted for now
			ethHoldings: lastKnownEthHoldings || 0,
			avgBuyPrice: lastKnownAvgBuyPrice || 0,
			usdHoldings: lastKnownUsdHoldings || 0,
			stakingRewards: lastKnownStakingRewards || 0,
			sharesOutstanding,
			marketCap: lastKnownStockPrice * sharesOutstanding,
			ethConcentration: lastKnownEthConcentration || 0,
			issuedAtmShares,
			notes: originalMetric?.notes || "",
			sharesBoughtBack: lastKnownSharesBoughtBack || 0,
		};

		companyMetrics.push(companyMetric);
	}

	return companyMetrics;
}

/**
 * Calculates current NAV based on real-time prices and latest company metrics
 * Includes alternative assets in the current NAV calculation.
 * This mirrors the frontend calculateCurrentNAV function.
 */
export async function calculateCurrentNAV(
	companyId: string,
	currentStockPrice?: number,
	currentEthPrice?: number,
): Promise<NavMetric | null> {
	try {
		// Get current prices if not provided
		const ethPrice = currentEthPrice || (await getCurrentEthPrice());
		const stockPrice = currentStockPrice || (await getCurrentBmnrPrice());

		if (!ethPrice || !stockPrice) {
			return null;
		}

		// Get all company metrics and stock prices for processing
		const [allMetrics, allStockPrices] = await Promise.all([
			getAllCompanyMetrics(companyId),
			getStockPrices(companyId),
		]);

		if (!allMetrics.length || !allStockPrices.length) {
			return null;
		}

		// Process metrics through the same pipeline as frontend
		const startDate = "2025-06-12"; // Same start date as frontend
		const processedMetrics = postFillMetrics(
			allMetrics,
			allStockPrices,
			startDate,
		);

		if (!processedMetrics.length) {
			return null;
		}

		// Get the latest processed metric (most recent date)
		const latestMetric = processedMetrics[processedMetrics.length - 1];

		// Get alternative assets value
		const alternativeAssetsValue = await getAlternativeAssetsValue(companyId);

		// Calculate NAV using the same logic as frontend
		const { ethHoldings, sharesOutstanding, usdHoldings } = latestMetric;

		if (!ethHoldings || !sharesOutstanding || usdHoldings === undefined) {
			return null;
		}

		const ethMarketValue = ethHoldings * ethPrice;
		const totalNavValue = ethMarketValue + usdHoldings + alternativeAssetsValue;
		const navPerShare = totalNavValue / sharesOutstanding;

		// Calculate market cap using current real-time stock price (not historical)
		const marketCap = stockPrice * sharesOutstanding;
		const mNav = marketCap / totalNavValue;

		return {
			companyId,
			date: new Date().toISOString().split("T")[0], // Today's date
			navPerShare,
			stockPrice,
			ethPrice,
			mNav,
			totalNavValue,
		};
	} catch (error) {
		return null;
	}
}

/**
 * Main function to calculate current MNAV for alert checking
 * This is the simplified version used by the monitoring service
 */
export async function calculateCurrentMnav(
	companyId: string,
): Promise<number | null> {
	const navResult = await calculateCurrentNAV(companyId);
	return navResult?.mNav || null;
}

export type {
	AlternativeAssetsPortfolio,
	CompanyMetric,
	CompanyMetrics,
	NavMetric,
	StockPrice,
};
