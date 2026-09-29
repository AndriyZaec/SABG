const APP_HOSTS = new Set(["app.sabg.fun", "localhost", "127.0.0.1", "[::1]"]);

export type Site = "app" | "landing";

export function siteForHostname(hostname: string): Site {
  return APP_HOSTS.has(hostname) ? "app" : "landing";
}
