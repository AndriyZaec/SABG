import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import {
  analyticsEnabled,
  denyConsent,
  getConsentSnapshot,
  grantConsent,
  subscribeConsent,
} from "./analytics.js";

export function ConsentBanner({ policyHref }: { policyHref: string }) {
  const { consent, settingsOpen } = useSyncExternalStore(subscribeConsent, getConsentSnapshot);
  const visible = analyticsEnabled && (consent === "unset" || settingsOpen);
  const bannerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const banner = bannerRef.current;
    if (!visible || !banner) return;
    const updateHeight = () => {
      document.documentElement.style.setProperty("--consent-banner-height", `${banner.getBoundingClientRect().height}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(banner);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty("--consent-banner-height");
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="nb-consent" ref={bannerRef} role="region" aria-label="Optional analytics">
      <div className="nb-consent__inner">
        <p className="nb-consent__text">
          Optional analytics helps us improve SABG. You can use the app without it.{" "}
          <a href={policyHref} target="_blank" rel="noreferrer">Cookie Policy</a>
        </p>
        <div className="nb-consent__actions">
          <button type="button" className="nb-btn" onClick={denyConsent}>No thanks</button>
          <button type="button" className="nb-btn" onClick={grantConsent}>Allow analytics</button>
        </div>
      </div>
    </div>
  );
}
