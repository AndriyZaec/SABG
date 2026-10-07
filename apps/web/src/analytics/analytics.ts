const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

export const analyticsEnabled = Boolean(MEASUREMENT_ID);

export type Consent = "unset" | "granted" | "denied";
export type ConsentSnapshot = { consent: Consent; settingsOpen: boolean };

const CONSENT_COOKIE = "sabg_consent";
const CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 182;
const SHARED_DOMAIN = "sabg.fun";

// Routes with IDs are reported as their pattern so reports group by screen.
const ID_ROUTES: Array<[RegExp, string]> = [
  [/^\/arena\/[^/]+\/(leaderboard|spectate|summary|payout)\/?$/, "/arena/:arenaId/$1"],
  [/^\/arena\/[^/]+\/?$/, "/arena/:arenaId"],
  [/^\/cs2\/series\/[^/]+\/?$/, "/cs2/series/:seriesId"],
  [/^\/cs2\/arena\/[^/]+\/?$/, "/cs2/arena/:arenaId"],
];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function normalizePath(pathname: string): string {
  for (const [pattern, template] of ID_ROUTES) {
    if (pattern.test(pathname)) return pathname.replace(pattern, template);
  }
  return pathname;
}

function sharedDomain(): string | null {
  const host = window.location.hostname;
  return host === SHARED_DOMAIN || host.endsWith(`.${SHARED_DOMAIN}`) ? `.${SHARED_DOMAIN}` : null;
}

function readConsent(): Consent {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CONSENT_COOKIE}=(granted|denied)`));
  return (match?.[1] as Consent | undefined) ?? "unset";
}

function writeConsent(consent: "granted" | "denied") {
  const domain = sharedDomain();
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${CONSENT_COOKIE}=${consent}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax` +
    (domain ? `; Domain=${domain}` : "") +
    secure;
}

function deleteGaCookies() {
  const domain = sharedDomain();
  for (const entry of document.cookie.split("; ")) {
    const name = entry.split("=")[0];
    if (!name?.startsWith("_ga")) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/`;
    if (domain) document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${domain}`;
  }
}

let snapshot: ConsentSnapshot = { consent: analyticsEnabled ? readConsent() : "unset", settingsOpen: false };
const listeners = new Set<() => void>();

function setSnapshot(next: ConsentSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConsentSnapshot(): ConsentSnapshot {
  return snapshot;
}

let gaLoaded = false;
let lastPath: string | null = null;
let pageLocation: string | null = null;

function loadGa() {
  if (gaLoaded || !MEASUREMENT_ID) return;
  gaLoaded = true;

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js expects the arguments object itself, not an array copy.
    window.dataLayer!.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID, { send_page_view: false });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  document.head.append(script);
}

function sendPageView() {
  if (!gaLoaded || !pageLocation) return;
  window.gtag?.("event", "page_view", { page_location: pageLocation });
}

export function trackPageView(pathname: string, search: string) {
  if (!analyticsEnabled) return;
  // StrictMode runs effects twice in dev; one path change is one page view.
  if (pathname + search === lastPath) return;
  lastPath = pathname + search;
  pageLocation = window.location.origin + normalizePath(pathname) + search;
  sendPageView();
}

export function grantConsent() {
  writeConsent("granted");
  setSnapshot({ consent: "granted", settingsOpen: false });
  loadGa();
  sendPageView();
}

export function denyConsent() {
  writeConsent("denied");
  if (gaLoaded) {
    deleteGaCookies();
    window.location.reload();
    return;
  }
  setSnapshot({ consent: "denied", settingsOpen: false });
}

export function openConsentSettings() {
  setSnapshot({ ...snapshot, settingsOpen: true });
}

if (analyticsEnabled && snapshot.consent === "granted") loadGa();
