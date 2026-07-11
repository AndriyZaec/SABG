// Ported from world-cup's config/txodds.ts. Axios client for the TXODDS API, authenticated
// on every request via the TxLine API token + guest JWT, and tracking rate-limit headers.

import axios from "axios";
import { TxLineService } from "../auth/txline.service.js";
import { GuestJwtService } from "../auth/guest-jwt.service.js";
import { liveConfig } from "./env.js";
import { ingestHeaders } from "../rate-limit.js";

export const txoddsClient = axios.create({
  baseURL: liveConfig.txodds.baseUrl,
  headers: { "Content-Type": "application/json" },
  timeout: 15_000,
});

txoddsClient.interceptors.request.use(async (axiosConfig) => {
  const [apiToken, jwt] = await Promise.all([
    TxLineService.getInstance().getApiToken(),
    GuestJwtService.getInstance().getJwt(),
  ]);
  axiosConfig.headers["X-Api-Token"] = apiToken;
  axiosConfig.headers["Authorization"] = `Bearer ${jwt}`;
  return axiosConfig;
});

txoddsClient.interceptors.response.use(
  (response) => {
    ingestHeaders(response.headers as Record<string, unknown>);
    return response;
  },
  (error: unknown) => {
    const headers = (error as { response?: { headers?: Record<string, unknown> } })?.response?.headers;
    if (headers) ingestHeaders(headers);
    return Promise.reject(error);
  },
);
