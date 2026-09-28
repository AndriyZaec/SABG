const LANDING_HOSTS = new Set(["sabg.fun", "www.sabg.fun", "landing.localhost"]);

export type Site = "app" | "landing";

export function siteForHostname(hostname: string): Site {
  return LANDING_HOSTS.has(hostname) ? "landing" : "app";
}
