import type { Cs2TeamIdentity } from "@arena/contracts";

export type Cs2TeamIdentityMap = ReadonlyMap<string, Cs2TeamIdentity>;

export function buildCs2TeamIdentityMap(
  teams: readonly { gridTeamId: string; teamId: string; name: string }[],
): Cs2TeamIdentityMap {
  const identities = new Map(teams.map((team) => [team.gridTeamId, { teamId: team.teamId, name: team.name }]));
  const internalIds = new Set(teams.map((team) => team.teamId));
  if (teams.length !== 2 || identities.size !== 2 || internalIds.size !== 2) {
    throw new Error("CS2 team identity mapping requires two distinct GRID teams");
  }
  return identities;
}
