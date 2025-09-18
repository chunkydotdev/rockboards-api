import type { Request, Response } from "express";
import type { ApiResponse } from "../types";

// Generic cache entry interface
interface CacheEntry<T> {
	data: T;
	timestamp: number;
	queryKey: string;
}

// Cache configuration options
interface CacheOptions {
	ttlMs: number; // Time to live in milliseconds
	generateKey?: (req: Request) => string; // Custom key generator
	keyPrefix?: string; // Prefix for cache keys
}

// Cache instance class
export class EndpointCache<T = unknown> {
	private cache = new Map<string, CacheEntry<T>>();
	public readonly ttlMs: number;
	private keyPrefix: string;
	private generateKey: (req: Request) => string;

	constructor(options: CacheOptions) {
		this.ttlMs = options.ttlMs;
		this.keyPrefix = options.keyPrefix || "cache";
		this.generateKey = options.generateKey || this.defaultKeyGenerator;
	}

	// Default key generator based on query parameters
	private defaultKeyGenerator = (req: Request): string => {
		const queryParams = Object.entries(req.query)
			.filter(([_, value]) => value !== undefined && value !== "")
			.map(([key, value]) => `${key}:${value}`)
			.sort()
			.join("|");

		return `${this.keyPrefix}:${queryParams || "no-params"}`;
	};

	// Check if cached data exists and is valid
	public get(req: Request): T | null {
		const key = this.generateKey(req);
		const entry = this.cache.get(key);

		if (!entry) return null;

		const isExpired = Date.now() - entry.timestamp >= this.ttlMs;
		if (isExpired) {
			this.cache.delete(key);
			return null;
		}

		return entry.data;
	}

	// Store data in cache
	public set(req: Request, data: T): void {
		const key = this.generateKey(req);
		this.cache.set(key, {
			data,
			timestamp: Date.now(),
			queryKey: key,
		});
	}

	// Get cache key for request (useful for debugging)
	public getKey(req: Request): string {
		return this.generateKey(req);
	}

	// Check if request has cached data
	public has(req: Request): boolean {
		return this.get(req) !== null;
	}

	// Clear entire cache
	public clear(): number {
		const size = this.cache.size;
		this.cache.clear();
		return size;
	}

	// Get cache statistics
	public getStats() {
		const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
			key,
			queryKey: entry.queryKey,
			cachedAt: new Date(entry.timestamp).toISOString(),
			expiresAt: new Date(entry.timestamp + this.ttlMs).toISOString(),
			timeToExpireMs: Math.max(0, entry.timestamp + this.ttlMs - Date.now()),
			dataSize: Array.isArray(entry.data) ? entry.data.length : 1,
		}));

		return {
			totalEntries: this.cache.size,
			ttlHours: this.ttlMs / (60 * 60 * 1000),
			entries,
		};
	}
}

// Convenience function to create cache middleware
export function createCacheMiddleware<T>(
	cache: EndpointCache<T>,
	dataFetcher: (req: Request, res: Response) => Promise<T>,
) {
	return async (req: Request, res: Response) => {
		// Check cache first
		const cachedData = cache.get(req);

		if (cachedData !== null) {
			// Cache hit
			const response: ApiResponse<T> = { data: cachedData };

			res.set({
				"Cache-Control": `public, max-age=${Math.floor(cache.ttlMs / 1000)}`,
				"X-Cache": "HIT",
				"X-Cache-Key": cache.getKey(req),
			});

			return res.json(response);
		}

		// Cache miss - fetch fresh data
		const freshData = await dataFetcher(req, res);

		// Store in cache
		cache.set(req, freshData);

		const response: ApiResponse<T> = { data: freshData };

		res.set({
			"Cache-Control": `public, max-age=${Math.floor(cache.ttlMs / 1000)}`,
			"X-Cache": "MISS",
			"X-Cache-Key": cache.getKey(req),
		});

		res.json(response);
	};
}

// Helper functions for common cache durations
export const CacheDuration = {
	MINUTE: 60 * 1000,
	MINUTES: (n: number) => n * 60 * 1000,
	HOUR: 60 * 60 * 1000,
	HOURS: (n: number) => n * 60 * 60 * 1000,
	DAY: 24 * 60 * 60 * 1000,
	DAYS: (n: number) => n * 24 * 60 * 60 * 1000,
};

// Helper function to create cache management routes
export function createCacheManagementRoutes<T>(
	cache: EndpointCache<T>,
	routePrefix = "/cache",
) {
	return {
		// GET /cache/info
		info: async (req: Request, res: Response) => {
			const stats = cache.getStats();
			const response: ApiResponse<typeof stats> = { data: stats };
			res.json(response);
		},

		// DELETE /cache/clear
		clear: async (req: Request, res: Response) => {
			const clearedEntries = cache.clear();
			const response: ApiResponse<{
				message: string;
				clearedEntries: number;
			}> = {
				data: {
					message: "Cache cleared successfully",
					clearedEntries,
				},
			};
			res.json(response);
		},
	};
}
