import { Router } from "express";
import type { Router as RouterType } from "express";
import { z } from "zod";
import type {
  ApiError,
  Cs2SeriesDetail,
  Cs2SeriesDetailResponse,
  Cs2SeriesListResponse,
  Cs2SeriesSummary,
  Uuid,
} from "@arena/contracts";
import { cs2CatalogRepository } from "../db/repositories/cs2-catalog.repository.js";

export interface Cs2CatalogReadStore {
  listSupported(): Promise<Cs2SeriesSummary[]>;
  findSupportedDetailById(id: Uuid): Promise<Cs2SeriesDetail | undefined>;
}

export function createCs2CatalogRouter(store: Cs2CatalogReadStore = cs2CatalogRepository): RouterType {
  const router = Router();

  router.get<Record<string, never>, Cs2SeriesListResponse>("/series", async (_req, res) => {
    res.json({ series: await store.listSupported() });
  });

  router.get<{ seriesId: string }, Cs2SeriesDetailResponse | ApiError>("/series/:seriesId", async (req, res) => {
    const parsedId = z.string().uuid().safeParse(req.params.seriesId);
    if (!parsedId.success) {
      res.status(400).json({ error: "bad_request", message: "seriesId must be a UUID" });
      return;
    }
    const series = await store.findSupportedDetailById(parsedId.data);
    if (series === undefined) {
      res.status(404).json({ error: "not_found", message: "Series not found" });
      return;
    }
    res.json({ series });
  });

  return router;
}
