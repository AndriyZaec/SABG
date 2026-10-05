const APP_HOSTS = new Set(["app.sabg.fun", "localhost", "127.0.0.1", "[::1]"]);

export type Site = "app" | "landing";

export function siteForHostname(hostname: string): Site {
  // Dev only: an ngrok tunnel opens the app for phone testing; production builds drop this branch.
  if (import.meta.env.DEV && /\.ngrok-free\.(app|dev)$/.test(hostname)) return "app";
  return APP_HOSTS.has(hostname) ? "app" : "landing";
}
