import { useEffect, useRef, useState } from "react";
import "./landing.css";

const SCENES = [
  { id: "watch", label: "Watch" },
  { id: "predict", label: "Predict" },
  { id: "survive", label: "Survive" },
  { id: "claim", label: "Claim" },
] as const;

function appUrl(): string {
  if (window.location.hostname === "landing.localhost") {
    return `${window.location.protocol}//localhost${window.location.port ? `:${window.location.port}` : ""}`;
  }
  return "https://app.sabg.fun";
}

export function LandingPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const sceneRefs = useRef<Array<HTMLElement | null>>([]);
  const [activeScene, setActiveScene] = useState(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (visible) setActiveScene(Number((visible.target as HTMLElement).dataset.scene));
      },
      { root: pageRef.current, threshold: [0.35, 0.55, 0.75] },
    );

    sceneRefs.current.forEach((scene) => scene && observer.observe(scene));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-page" ref={pageRef}>
      <header className="kinetic-nav">
        <a className="kinetic-nav__mark" href="#watch" aria-label="SABG home">SABG</a>
        <span>{SCENES[activeScene]?.label}</span>
      </header>

      <nav className="scene-progress" aria-label="Landing sections">
        {SCENES.map((scene, index) => (
          <a
            key={scene.id}
            href={`#${scene.id}`}
            aria-label={`Go to ${scene.label}`}
            aria-current={activeScene === index ? "step" : undefined}
          ><span>{scene.label}</span></a>
        ))}
      </nav>

      <main>
        <section
          className={`kinetic-scene watch-scene ${activeScene === 0 ? "is-active" : ""}`}
          id="watch"
          data-scene="0"
          ref={(node) => { sceneRefs.current[0] = node; }}
          aria-labelledby="watch-title"
        >
          <div className="scene-wrap watch-scene__layout">
            <div className="scene-copy">
              <p className="scene-kicker">01 / Watch</p>
              <h1 id="watch-title">Live esports,<br />now playable.</h1>
              <p className="scene-lede">SABG turns every match into a survival game.</p>
            </div>
            <div className="broadcast-score" aria-label="NAVI 10, Vitality 10">
              <div className="broadcast-score__signal"><i /> Live / CS2</div>
              <div className="broadcast-score__teams">
                <strong>NAVI</strong><p><b>10</b><i>:</i><b>10</b></p><strong>Vitality</strong>
              </div>
              <footer><span>Mirage / Round 21</span><span>More arenas follow</span></footer>
            </div>
          </div>
          <a className="scene-next" href="#predict">Next / Predict</a>
        </section>

        <section
          className={`kinetic-scene predict-scene ${activeScene === 1 ? "is-active" : ""}`}
          id="predict"
          data-scene="1"
          ref={(node) => { sceneRefs.current[1] = node; }}
          aria-labelledby="predict-title"
        >
          <div className="scene-wrap predict-scene__layout">
            <p className="scene-kicker">02 / Predict</p>
            <h2 id="predict-title">Will the attack<br />close the round?</h2>
            <p className="scene-lede">Every live moment becomes a Yes / No call.</p>
            <div className="prediction-visual" aria-label="Prediction choices: Yes or No">
              <span>Yes</span><i>Locks 00:06</i><span>No</span>
              <div aria-hidden="true"><b /></div>
            </div>
          </div>
          <a className="scene-next" href="#survive">Next / Survive</a>
        </section>

        <section
          className={`kinetic-scene survive-scene ${activeScene === 2 ? "is-active" : ""}`}
          id="survive"
          data-scene="2"
          ref={(node) => { sceneRefs.current[2] = node; }}
          aria-labelledby="survive-title"
        >
          <div className="scene-wrap survive-scene__layout">
            <div className="scene-copy">
              <p className="scene-kicker">03 / Survive</p>
              <h2 id="survive-title">Outlast<br />the field.</h2>
              <p className="scene-lede">Read the match. Stay alive as the arena gets smaller.</p>
            </div>
            <div className="survival-board" aria-label="Your rank rises from 12 to 3 as survivors fall from 24 to 7">
              <div className="survival-board__counts"><span><b>24</b> survivors</span><i>to</i><span><b>7</b> survivors</span></div>
              <ol>
                <li className="survival-board__out"><span>#08</span><strong>ecoCobra</strong><b>Out</b></li>
                <li><span>#05</span><strong>pixelpeek</strong><b>16</b></li>
                <li className="survival-board__you"><span>#03</span><strong>You</strong><b>18</b></li>
                <li className="survival-board__out"><span>#14</span><strong>midControl</strong><b>Out</b></li>
              </ol>
            </div>
          </div>
          <a className="scene-next" href="#claim">Next / Claim</a>
        </section>

        <section
          className={`kinetic-scene claim-scene ${activeScene === 3 ? "is-active" : ""}`}
          id="claim"
          data-scene="3"
          ref={(node) => { sceneRefs.current[3] = node; }}
          aria-labelledby="claim-title"
        >
          <div className="scene-wrap claim-scene__layout">
            <p className="scene-kicker">04 / Claim</p>
            <h2 id="claim-title">Last survivors<br />split the pool.</h2>
            <div className="settlement-line" aria-label="Live events lead to a deterministic result and devnet payout">
              <span>Live events</span><i>&gt;</i><span>Result</span><i>&gt;</i><span>Devnet payout</span>
            </div>
            <a className="claim-cta" href={appUrl()}>Enter the arena</a>
            <p className="claim-note">Private beta / invite code required</p>
          </div>
          <footer className="claim-footer"><strong>SABG</strong><span>CS2 first. More esports arenas next.</span></footer>
        </section>
      </main>
    </div>
  );
}
