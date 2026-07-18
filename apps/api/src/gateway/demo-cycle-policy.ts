export const DEMO_REPLAY_CYCLE_EXIT_CODE = 75;

export function shouldCycleReplay(source: "replay" | "live", enabled: boolean): boolean {
  return enabled && source === "replay";
}

export function shouldResetAfterGatewayExit(exitCode: number | null, stopping: boolean): boolean {
  return !stopping && exitCode === DEMO_REPLAY_CYCLE_EXIT_CODE;
}
