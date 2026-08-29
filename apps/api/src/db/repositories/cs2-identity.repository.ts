import type { Cs2TeamIdentity, Uuid } from "@arena/contracts";
import { db } from "../client.js";
import { reconcileSeriesParticipants } from "./cs2-participant-lifecycle.repository.js";

export interface GridCs2TeamInput {
  gridTeamId: string;
  name: string;
  shortName?: string;
  logoUrl?: string;
  score: number;
}

export interface Cs2SeriesTeamIdentity extends Cs2TeamIdentity {
  gridTeamId: string;
  displayOrder: 1 | 2;
  seriesScore: number;
}

function validateInput(teams: readonly [GridCs2TeamInput, GridCs2TeamInput]): void {
  if (
    teams.some(
      (team) =>
        team.gridTeamId.trim() === "" ||
        team.name.trim() === "" ||
        !Number.isInteger(team.score) ||
        team.score < 0,
    )
  ) {
    throw new Error("CS2 series teams contain invalid identity or score data");
  }
  if (teams[0].gridTeamId === teams[1].gridTeamId) {
    throw new Error(`CS2 series teams contain duplicate GRID ID ${teams[0].gridTeamId}`);
  }
}

export const cs2IdentityRepository = {
  async synchronizeSeriesTeams(
    seriesId: Uuid,
    input: readonly [GridCs2TeamInput, GridCs2TeamInput],
  ): Promise<readonly [Cs2SeriesTeamIdentity, Cs2SeriesTeamIdentity]> {
    validateInput(input);

    return db.transaction(async (tx) => {
      const participants = await reconcileSeriesParticipants(
        tx,
        seriesId,
        input.map((team, index) => ({ ...team, displayOrder: (index + 1) as 1 | 2 })),
      );

      if (participants.length !== 2 || participants[0]?.displayOrder !== 1 || participants[1]?.displayOrder !== 2) {
        throw new Error(`CS2 series ${seriesId} does not have a complete participant pair`);
      }

      return participants as [Cs2SeriesTeamIdentity, Cs2SeriesTeamIdentity];
    });
  },
};
