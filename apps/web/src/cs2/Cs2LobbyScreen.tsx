import { Loading } from "../ui/Loading.js";
import { Cs2Catalog } from "./Cs2Catalog.js";
import { useCs2SeriesCatalog } from "./useCs2Catalog.js";

export function Cs2LobbyScreen() {
  const [catalog, retry] = useCs2SeriesCatalog();

  if (catalog.state === "loading") {
    return <div className="nb-container"><Loading label="Loading CS2 event…" /></div>;
  }

  if (catalog.state === "error") {
    return (
      <div className="nb-container">
        <div className="cs2-state cs2-state--error">
          <span className="nb-label">Feed unavailable</span>
          <h1>We lost the event signal.</h1>
          <p>The catalog could not be loaded. Your access is still active.</p>
          <button className="nb-btn nb-btn--primary" type="button" onClick={retry}>Try again</button>
        </div>
      </div>
    );
  }

  if (catalog.value.length === 0) {
    return (
      <div className="nb-container">
        <div className="cs2-state">
          <span className="nb-label">CS2 event desk</span>
          <h1>No series on the board.</h1>
          <p>Supported event fixtures will appear here when the schedule is published.</p>
        </div>
      </div>
    );
  }

  return <Cs2Catalog series={catalog.value} />;
}
