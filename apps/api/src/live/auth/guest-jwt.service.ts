// Ported from world-cup's services/guest-jwt.service.ts, with Redis caching swapped for the
// in-memory token-cache (see token-cache.ts — no-Redis decision for this port).

import axios from "axios";
import { getCached, setCached } from "./token-cache.js";
import { API_ORIGIN } from "../config/network.js";
import { logger } from "../logger.js";
import { UpstreamApiError } from "../errors.js";

export class GuestJwtService {
  private static instance: GuestJwtService;
  private readonly CACHE_KEY = "txline:devnet:guest-jwt";
  private readonly TTL_SECONDS = 60 * 30; // 30 minutes (recommended)

  public static getInstance(): GuestJwtService {
    if (!GuestJwtService.instance) {
      GuestJwtService.instance = new GuestJwtService();
    }
    return GuestJwtService.instance;
  }

  public async getJwt(): Promise<string> {
    const cachedJwt = getCached(this.CACHE_KEY);
    if (cachedJwt) {
      logger.debug("guest JWT loaded from cache");
      return cachedJwt;
    }

    logger.info("generating new guest JWT");
    const jwt = await this.generateNewJwt();

    setCached(this.CACHE_KEY, jwt, this.TTL_SECONDS);
    logger.info("guest JWT cached in memory (30 min)");

    return jwt;
  }

  private async generateNewJwt(): Promise<string> {
    try {
      const response = await axios.post<{ token?: string }>(
        `${API_ORIGIN}/auth/guest/start`,
        {},
        { headers: { "Content-Type": "application/json" } },
      );

      const jwt = response.data?.token;
      if (!jwt) {
        throw new UpstreamApiError("Guest auth response did not include a token");
      }

      return jwt;
    } catch (error: unknown) {
      const response = (error as { response?: { data?: unknown; status?: number } }).response;
      logger.error({ err: response?.data ?? (error as Error).message }, "failed to generate guest JWT");
      throw new UpstreamApiError("Failed to obtain guest JWT", response?.status, error);
    }
  }
}
