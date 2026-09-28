import { useEffect, useRef, useState } from "react";
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
            <div className="broadcast-score" aria-label="NAVI 10, Vitality 10">
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
