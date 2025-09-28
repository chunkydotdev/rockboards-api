export interface Company {
	id: string;
	name: string;
	ticker: string;
	website?: string;
	created_at: string;
}

export interface CompanyMetrics {
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

export interface DateMetric<T> {
	value: T;
	date: string;
	companyId: string;
}

export interface NavMetric {
	companyId: string;
	date: string;
	navPerShare: number; // ethConcentration * ethHoldings / sharesOutstanding
	stockPrice: number; // database
	ethPrice: number; // database
	mNav: number; // totalNavValue / marketCap (mNav = 1 is no premium/discount)
	totalNavValue: number; // ethPrice * ethHoldings
}

export interface CompanyMetric {
	weightedAvgBuyPrice: number;
	companyId: string;
	date: string;
	ethHoldings: number; // database + post-fill
	avgBuyPrice: number; // database + post-fill
	usdHoldings: number; // database + post-fill
	stakingRewards: number; // database + post-fill
	sharesOutstanding: number; // ethConcentration * ethHoldings
	marketCap: number; // sharesOutstanding * stockPrice
	ethConcentration: number; // database + post-fill
	issuedAtmShares: number; // calc from sharesOutstanding and later dates
	notes: string; // database
}

export interface StockPrice {
	id: string;
	company_id: string;
	date: string;
	open?: number;
	high?: number;
	low?: number;
	close?: number;
	volume?: number;
}

export interface Event {
	id: string;
	company_id: string;
	date: string;
	title: string;
	description?: string;
	source_url?: string;
}

// Real-time stock price from Yahoo Finance
export interface RealtimeStockPrice {
	ticker: string;
	price: number;
	currency: string;
	regularMarketPrice: number;
	regularMarketChange: number;
	regularMarketChangePercent: number;
	regularMarketTime: string;
	regularMarketPreviousClose: number;
	regularMarketOpen: number;
	regularMarketDayLow: number;
	regularMarketDayHigh: number;
	regularMarketVolume: number;
	marketState: string;
	exchangeName: string;
	fullExchangeName: string;
	displayName: string;
	longName: string;
	preMarketPrice: number;
	preMarketChange: number;
	preMarketChangePercent: number;
	preMarketTime: string;
	postMarketPrice: number;
	postMarketChange: number;
	postMarketChangePercent: number;
	postMarketTime: string;
}

// Cached version of RealtimeStockPrice with cache metadata
export interface CachedRealtimeStockPrice extends RealtimeStockPrice {
	cache: {
		cachedAt: string;
		expiresAt: string;
		timeToRefreshMs: number;
		timeToRefreshMinutes: number;
		isFromCache: boolean;
	};
}

// NAV Calculations
export interface NAVData {
	date: string;
	navPerShare: number;
	stockPrice: number;
	ethPrice: number;
	premiumDiscount: number; // Percentage premium (+) or discount (-) to NAV
	premiumDiscountAmount: number; // Dollar amount
	totalNavValue: number;
	marketCap: number;
	ethConcentration: number;
	ethAmount: number;
	usdAmount: number;
}

// Response types for API routes
export interface CompanyWithData extends Company {
	company_metrics?: CompanyMetrics[];
	stock_prices?: StockPrice[];
	events?: Event[];
}

export interface ApiResponse<T> {
	data: T;
	error?: string;
	message?: string;
}

// Legacy type for backward compatibility
export interface EthHolding extends CompanyMetrics {
	usd_value?: number; // Maps to usd_amount for compatibility
}

// Options data interfaces
export interface OptionsData {
	underlyingSymbol: string;
	expirationDates: Date[];
	strikes: number[];
	hasMiniOptions: boolean;
	quote: {
		underlyingSymbol: string;
		currency: string;
		regularMarketTime: Date;
		lastMarket: string;
		lastPrice: number;
		change: number;
		percentChange: number;
		volume: number;
		openInterest: number;
		bid: number;
		ask: number;
	};
	options: Array<{
		expirationDate: Date;
		hasMiniOptions: boolean;
		calls: Array<{
			contractSymbol: string;
			strike: number;
			currency: string;
			lastPrice: number;
			change: number;
			percentChange: number;
			volume: number;
			openInterest: number;
			bid: number;
			ask: number;
			contractSize: string;
			expiration: Date;
			lastTradeDate: Date;
			impliedVolatility: number;
			inTheMoney: boolean;
		}>;
		puts: Array<{
			contractSymbol: string;
			strike: number;
			currency: string;
			lastPrice: number;
			change: number;
			percentChange: number;
			volume: number;
			openInterest: number;
			bid: number;
			ask: number;
			contractSize: string;
			expiration: Date;
			lastTradeDate: Date;
			impliedVolatility: number;
			inTheMoney: boolean;
		}>;
	}>;
}

export interface ProcessedOptionsData {
	ticker: string;
	impliedVolatility: number | null;
	putCallRatio: number | null;
	totalCallVolume: number;
	totalPutVolume: number;
	totalCallOpenInterest: number;
	totalPutOpenInterest: number;
	optionsCount: {
		calls: number;
		puts: number;
		total: number;
	};
	expirationDates: string[];
	lastUpdated: string;
}

// Alternative Assets - Extended and unified asset tracking system
export interface AlternativeAsset {
	id: string;
	company_id: string;

	// Asset identification
	asset_type:
		| "equity"
		| "commodity"
		| "real_estate"
		| "crypto"
		| "bond"
		| "other";
	asset_category: "strategic" | "hedge" | "diversification" | "other";
	ticker?: string; // For publicly traded assets
	asset_name: string;

	// Investment details
	purchase_date: string;
	shares_purchased: number;
	shares_remaining: number; // Current shares held (after any sales)
	purchase_price_per_share: number;
	total_cost: number; // Original total cost of shares_purchased
	investment_thesis?: string;
	status: "active" | "sold" | "partial_sale";
	created_at: string;
	updated_at: string;

	// Calculated fields (for UI)
	company_name?: string; // From companies table join
	shares_sold?: number; // shares_purchased - shares_remaining
	remaining_cost_basis?: number; // (shares_remaining / shares_purchased) * total_cost
	current_price?: number; // From realtime_stock_prices table
	current_value?: number; // shares_remaining * current_price
	unrealized_gain_loss?: number; // current_value - remaining_cost_basis
	unrealized_gain_loss_percent?: number;

	// Optional relations
	transactions?: AlternativeAssetTransaction[];
	price_history?: StockPrice[]; // Uses existing stock_prices table
}

export interface AlternativeAssetsPortfolio {
	totalAssets: number;
	totalCostBasis: number;
	totalCurrentValue: number;
	totalUnrealizedGainLoss: number;
	totalUnrealizedGainLossPercent: number;
	assets: AlternativeAsset[];
	allocationPercentOfTreasury: number;

	// Groupings
	assetsByCategory: Record<string, AlternativeAsset[]>;
	assetsByType: Record<string, AlternativeAsset[]>;
}

export interface AlternativeAssetTransaction {
	id: string;
	asset_id: string;
	transaction_type: "buy" | "sell";
	transaction_date: string;
	shares: number;
	price_per_share: number;
	total_amount: number;
	fees?: number;
	notes?: string;
	created_at: string;
}

// Note: Alternative asset prices are stored in the existing stock_prices table
// linked via company_id. This reuses the existing infrastructure.

// Activity tracking types
export interface TrackActivityRequest {
	activity_type: "dashboard_view" | "poll_vote";
	duration_seconds?: number;
	session_id: string;
}

export interface TrackActivityResponse {
	points_awarded: number;
}

export interface ActivityStatsResponse {
	daily_points: number;
	weekly_points: number;
	active_days_this_week: number;
	date: string;
	max_daily_points: number;
	is_market_day: boolean;
}

// Daily poll types
export interface DailyPoll {
	id: string;
	asset_symbol: "BMNR" | "ETH-USD";
	poll_date: string;
	target_price?: number;
	step_size: number;
	max_points: number;
	market_open_time?: string;
	market_close_time?: string;
	cutoff_time?: string;
	early_bonus_cutoff?: string;
	status: "open" | "settled";
	created_at: string;
}

export interface DailyPollVote {
	id: string;
	poll_id: string;
	user_id: string;
	predicted_price: number;
	points_earned: number;
	early_bonus_applied: boolean;
	created_at: string;
}

export interface CreateDailyPollRequest {
	asset_symbol: "BMNR" | "ETH-USD";
	poll_date: string;
	step_size?: number;
	max_points?: number;
	market_open_time?: string;
	market_close_time?: string;
}

export interface SubmitVoteRequest {
	poll_id: string;
	predicted_price: number;
}

export interface SettlePollRequest {
	poll_id: string;
	target_price: number;
}

export interface AutoSettlePollRequest {
	asset_symbol: "BMNR" | "ETH-USD";
	poll_date: string;
	target_price: number;
}

export interface AutoCreatePollRequest {
	date: string;
	assets: ("BMNR" | "ETH-USD")[];
}
