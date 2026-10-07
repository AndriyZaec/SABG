import { useEffect, useSyncExternalStore } from "react";
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

  useEffect(() => {
    document.body.classList.toggle("has-consent-banner", visible);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="nb-consent" role="region" aria-label="Cookie consent">
      <div className="nb-consent__inner">
        <p className="nb-consent__text">
          We use Google Analytics cookies to see how people find and use SABG.{" "}
          <a href={policyHref} target="_blank" rel="noreferrer">Cookie Policy</a>
        </p>
        <div className="nb-consent__actions">
          <button type="button" className="nb-btn" onClick={denyConsent}>Reject</button>
          <button type="button" className="nb-btn" onClick={grantConsent}>Accept</button>
        </div>
      </div>
    </div>
  );
}
