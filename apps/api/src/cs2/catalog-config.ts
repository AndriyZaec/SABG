import dotenv from "dotenv";
import { cs2Config } from "./config/env.js";

dotenv.config();

export function parseCatalogTournamentIds(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") return [];
  const ids = value.split(",").map((id) => id.trim());
  if (ids.some((id) => id === "")) {
    throw new Error("CS2_CATALOG_TOURNAMENT_IDS must be a comma-separated list without empty IDs");
  }
  return [...new Set(ids)];
}

export const cs2CatalogConfig = {
  tournamentIds: parseCatalogTournamentIds(process.env["CS2_CATALOG_TOURNAMENT_IDS"]),
  activeGridSeriesId: cs2Config.mode === "live" ? cs2Config.activeGridSeriesId : undefined,
};
