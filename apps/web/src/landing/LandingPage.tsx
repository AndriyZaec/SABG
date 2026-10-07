import { useEffect, useRef, useState } from "react";
import { trackPageView } from "../analytics/analytics.js";
import { ConsentBanner } from "../analytics/ConsentBanner.js";
import "./landing.css";

const SCENES = [
  { id: "watch", label: "Watch" },
  { id: "predict", label: "Predict" },
  { id: "survive", label: "Survive" },
  { id: "claim", label: "Claim" },
] as const;

const PREDICTION_SECONDS = 6;

type PredictionChoice = "yes" | "no";
type PredictionRound =
  | { phase: "open"; choice: PredictionChoice | null; secondsLeft: number; round: number }
  | { phase: "resolved"; choice: PredictionChoice | null; result: "alive" | "out"; round: number };

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
  const [prediction, setPrediction] = useState<PredictionRound>({
    phase: "open",
    choice: null,
    secondsLeft: PREDICTION_SECONDS,
    round: 0,
  });

  useEffect(() => {
    trackPageView("/", window.location.search);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      () => {
        const rootBounds = pageRef.current?.getBoundingClientRect();
        if (!rootBounds) return;

        const visibleRatio = (scene: HTMLElement) => {
          const bounds = scene.getBoundingClientRect();
          const visibleHeight = Math.max(
            0,
            Math.min(bounds.bottom, rootBounds.bottom) - Math.max(bounds.top, rootBounds.top),
          );
          return visibleHeight / bounds.height;
        };

        setActiveScene((current) => {
          const currentScene = sceneRefs.current[current];
          let next = current;
          let largestRatio = currentScene ? visibleRatio(currentScene) : 0;

          sceneRefs.current.forEach((scene, index) => {
            if (!scene) return;
            const ratio = visibleRatio(scene);
            if (ratio > largestRatio) {
              largestRatio = ratio;
              next = index;
            }
          });

          return next;
        });
      },
      { root: pageRef.current, threshold: [0, 0.35, 0.55, 0.75, 1] },
    );

    sceneRefs.current.forEach((scene) => scene && observer.observe(scene));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (activeScene !== 1) return;

    setPrediction((current) => ({
      phase: "open",
      choice: null,
      secondsLeft: PREDICTION_SECONDS,
      round: current.round + 1,
    }));
  }, [activeScene]);

  useEffect(() => {
    if (activeScene !== 1) return;

    if (prediction.phase === "resolved") return;

    if (prediction.secondsLeft === 0) {
      setPrediction({
        phase: "resolved",
        choice: prediction.choice,
        result: prediction.choice === "yes" ? "alive" : "out",
        round: prediction.round,
      });
      return;
    }

    const tick = window.setTimeout(() => {
      setPrediction((current) => current.phase === "open"
        ? { ...current, secondsLeft: current.secondsLeft - 1 }
        : current);
    }, 1000);
    return () => window.clearTimeout(tick);
  }, [activeScene, prediction]);

  const choosePrediction = (choice: PredictionChoice) => {
    setPrediction((current) => current.phase === "open" && current.choice === null
      ? { ...current, choice }
      : current);
  };

  return (
    <div className="landing-page" ref={pageRef}>
      <header className="kinetic-nav">
        <a className="kinetic-nav__mark" href="#watch" aria-label="SABG home">SABG</a>
        <a className="kinetic-nav__cta" href={appUrl()}>Enter arena</a>
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
              <h1 id="watch-title"><span>Live esports,</span><span>now playable.</span></h1>
              <p className="scene-lede">SABG turns every match into a survival game.</p>
            </div>
            <div className="broadcast-score" role="img" aria-label="Live CS2 score: NAVI 10, Vitality 10. Mirage, round 21.">
              <div className="broadcast-score__signal"><i /> Live / CS2</div>
              <div className="broadcast-score__teams" aria-hidden="true">
                <div className="broadcast-team broadcast-team--navi">
                  <img src="/landing/navi.png" alt="" />
                  <strong>NAVI</strong>
                </div>
                <p className="broadcast-score__result">
                  <span className="score-number score-number--changed">
                    <b className="score-number__old">9</b>
                    <b className="score-number__new">10</b>
                  </span>
                  <i>:</i>
                  <span className="score-number"><b>10</b></span>
                </p>
                <div className="broadcast-team broadcast-team--vitality">
                  <img src="/landing/vitality.png" alt="" />
                  <strong>Vitality</strong>
                </div>
              </div>
              <footer><span>Mirage / Round 21</span></footer>
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
            <h2 id="predict-title"><span>Will the attack</span><span>close the round?</span></h2>
            <p className="scene-lede">Every live moment becomes a Yes / No call.</p>
            <div
              className={`prediction-visual prediction-state--${prediction.phase} ${prediction.choice ? "has-choice" : ""}`}
              role="group"
              aria-label="Prediction choices: Yes or No"
            >
              <button
                className={`prediction-choice prediction-choice--yes ${prediction.choice === "yes" ? "is-selected" : ""}`}
                type="button"
                aria-pressed={prediction.choice === "yes"}
                disabled={prediction.phase === "resolved" || prediction.choice !== null}
                onClick={() => choosePrediction("yes")}
              >Yes</button>
              <i>{prediction.phase === "open" ? `Locks 00:0${prediction.secondsLeft}` : "Settled"}</i>
              <button
                className={`prediction-choice prediction-choice--no ${prediction.choice === "no" ? "is-selected" : ""}`}
                type="button"
                aria-pressed={prediction.choice === "no"}
                disabled={prediction.phase === "resolved" || prediction.choice !== null}
                onClick={() => choosePrediction("no")}
              >No</button>
              <div className="prediction-timeline" key={prediction.round} aria-hidden="true"><b /></div>
              <p className={`prediction-status ${prediction.phase === "resolved" ? `prediction-status--${prediction.result}` : prediction.choice ? "prediction-status--locked" : ""}`} aria-live="polite">
                {prediction.phase === "resolved"
                  ? <strong>{prediction.result}</strong>
                  : prediction.choice
                    ? <><span className="prediction-lock"><i />Call locked</span><strong>{prediction.choice}</strong></>
                    : <strong>Make your call</strong>}
              </p>
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
              <h2 id="survive-title"><span>Outlast</span><span>the</span><span>arena.</span></h2>
              <p className="scene-lede">Read the match. Stay alive as the arena gets smaller.</p>
            </div>
            <div className="survival-board" role="img" aria-label="Round 8: 7 of 24 players remain. You lead with 8 points.">
              <header className="survival-board__mast"><span><i /> Live</span><strong>Round 08</strong></header>
              <div className="survival-board__counts">
                <span><small>Arena</small><b>24</b> players</span>
                <svg className="survival-arrow" viewBox="0 0 36 30" aria-hidden="true">
                  <path className="survival-arrow__shadow" d="M2 9h16V3l14 11-14 11v-6H2z" />
                  <path className="survival-arrow__face" d="M1 7h16V1l14 11-14 11v-6H1z" />
                </svg>
                <span><small>Remaining</small><b>7</b> survivors</span>
              </div>
              <ol aria-hidden="true">
                <li className="survival-board__out survival-row--one"><span>#08</span><strong>ecoCobra</strong><b>Out</b></li>
                <li className="survival-row--two">
                  <span className="survival-rank survival-rank--changing"><i>#05</i><i>#02</i></span><strong>0xDecadance</strong><b>8</b>
                </li>
                <li className="survival-board__you survival-row--three">
                  <span className="survival-rank survival-rank--changing"><i>#03</i><i>#01</i></span><strong>You</strong><b>8</b>
                </li>
                <li className="survival-board__out survival-row--four"><span>#14</span><strong>midControl</strong><b>Out</b></li>
                <li className="survival-board__incoming survival-row--five"><span>#03</span><strong>vikipick</strong><b>8</b></li>
                <li className="survival-board__incoming survival-row--six"><span>#04</span><strong>RageBrain</strong><b>8</b></li>
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
            <h2 id="claim-title"><span>Last survivors</span><span>split the pool.</span></h2>
            <div className="settlement-line" aria-label="Live events and your call lead to a deterministic result and payout">
              <span>Live events</span><i>&gt;</i><span>Your call</span><i>&gt;</i><span>Result</span><i>&gt;</i><span>Payout</span>
            </div>
            <a className="claim-cta" href={appUrl()}>Enter the arena</a>
            <p className="claim-note">Private beta / invite code required</p>
          </div>
          <footer className="claim-footer">
            <span>© 2026 SABG</span>
            <span className="claim-footer__status"><span>Open beta</span><strong>Soon</strong></span>
            <a href="https://x.com/sabg_sol" target="_blank" rel="noreferrer" aria-label="SABG on X">
              <img src="/landing/x-logo.png" alt="" />
            </a>
          </footer>
        </section>
      </main>
      <ConsentBanner policyHref={`${appUrl()}/cookies`} />
    </div>
  );
}
