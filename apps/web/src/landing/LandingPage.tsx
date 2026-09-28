function appUrl(): string {
  if (window.location.hostname === "landing.localhost") {
    return `${window.location.protocol}//localhost${window.location.port ? `:${window.location.port}` : ""}`;
  }
  return "https://app.sabg.fun";
}

export function LandingPage() {
  return (
    <main className="nb-access">
      <div className="nb-access__court" aria-hidden="true" />
      <section className="nb-access__ticket" aria-labelledby="landing-title">
        <header className="nb-access__ticket-head">
          <span className="nb-access__mark">SABG</span>
          <span className="nb-access__admit">Public site</span>
        </header>
        <div className="nb-access__ticket-body">
          <p className="nb-access__eyebrow">Landing route ready</p>
          <h1 id="landing-title">Read the game. Survive the match.</h1>
          <p className="nb-access__intro">
            This temporary shell verifies the public host split. The complete landing design follows after review.
          </p>
          <a className="nb-btn nb-btn--primary nb-btn--lg nb-btn--block" href={appUrl()}>
            Open app host
          </a>
        </div>
        <footer className="nb-access__ticket-foot">
          <span>Predict</span><span>Survive</span><span>Claim</span>
        </footer>
      </section>
    </main>
  );
}
