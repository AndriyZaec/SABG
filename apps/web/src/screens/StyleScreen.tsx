import { Button } from "../ui/Button.js";
import { Panel } from "../ui/Panel.js";
import { Badge } from "../ui/Badge.js";

const swatches: { cls: string; name: string; dark?: boolean }[] = [
  { cls: "nb-bg--yellow", name: "Yellow / CTA" },
  { cls: "nb-bg--green", name: "Survive" },
  { cls: "nb-bg--red", name: "Eliminate", dark: true },
  { cls: "nb-bg--blue", name: "Blue", dark: true },
  { cls: "nb-bg--pink", name: "Pink" },
  { cls: "nb-bg--ink", name: "Ink", dark: true },
  { cls: "nb-bg--white", name: "Paper" },
];

/** Design-system preview. Renders every primitive on one page — no backend needed. */
export function StyleScreen() {
  return (
    <div className="nb-container">
      <div
        className="nb-bg--ink nb-rise"
        style={{
          border: "var(--bw) solid var(--ink)",
          boxShadow: "var(--shadow)",
          padding: "22px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div className="nb-display" style={{ fontSize: "3rem", lineHeight: 0.85 }}>
            SABG
          </div>
          <div className="nb-label" style={{ color: "var(--white)", opacity: 0.85 }}>
            Matchday brutalism — style guide
          </div>
        </div>
        <Badge tone="live">Live system</Badge>
      </div>

      <section className="nb-section">
        <h2>Type</h2>
        <h1>Survive the match</h1>
        <h3 style={{ marginTop: 14 }}>Between 25:00 and 30:00 — will Team A have a shot?</h3>
        <p className="nb-mono" style={{ maxWidth: 560 }}>
          Body copy is Space Mono — raw, monospaced, honest. Read the game. Survive the match.
        </p>
        <p className="nb-label">Label · uppercase · tracked</p>
        <div className="nb-stat">17</div>
      </section>

      <section className="nb-section">
        <h2>Colour</h2>
        <div className="nb-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))" }}>
          {swatches.map((s) => (
            <div
              key={s.name}
              className={`nb-swatch ${s.cls}`}
              style={s.dark ? { color: "var(--white)" } : undefined}
            >
              {s.name}
            </div>
          ))}
        </div>
      </section>

      <section className="nb-section">
        <h2>Buttons</h2>
        <div className="nb-row">
          <Button variant="primary">Buy entry</Button>
          <Button variant="survive">Yes</Button>
          <Button variant="danger">No</Button>
          <Button variant="plain">Ghost</Button>
          <Button variant="primary" lg>
            Settle &amp; pay out
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div style={{ marginTop: 14, maxWidth: 320 }}>
          <Button variant="survive" block>
            Block button
          </Button>
        </div>
        <p className="nb-label" style={{ marginTop: 10 }}>
          Click a button — it shoves down into its shadow.
        </p>
      </section>

      <section className="nb-section">
        <h2>Panels</h2>
        <div className="nb-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
          <Panel title="Demo Arena" accent="yellow">
            Entry 0.1 SOL · Pool 0.4 SOL · 12 players
          </Panel>
          <Panel title="Survivors" accent="green">
            8 still standing
          </Panel>
          <Panel title="Eliminated" accent="red">
            You&apos;re out at 55:00
          </Panel>
          <Panel accent="blue">No title bar — just a plain body block.</Panel>
        </div>
      </section>

      <section className="nb-section">
        <h2>Badges</h2>
        <div className="nb-row">
          <Badge tone="live">Live</Badge>
          <Badge tone="survive">Survived</Badge>
          <Badge tone="eliminated">Eliminated</Badge>
          <Badge tone="neutral">Round 6</Badge>
        </div>
      </section>
    </div>
  );
}
