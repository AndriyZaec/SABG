import { useState } from "react";
import type { FormEvent } from "react";
import type { AdminLeaderboardPrize, AdminLeaderboardScope } from "@arena/contracts";

const MAX_PRIZE_PLACE = 100;

/** Prizes of one open scope: set a place's image URL, or ask to remove a place. */
export function PrizeEditor({ scopes, scope, disabled, onSelectScope, onSet, onRemove }: {
  /** Open scopes, the only ones whose prizes can change. */
  scopes: AdminLeaderboardScope[];
  scope: AdminLeaderboardScope;
  disabled: boolean;
  onSelectScope: (scopeId: string) => void;
  onSet: (place: number, imageUrl: string) => Promise<boolean>;
  onRemove: (prize: AdminLeaderboardPrize) => void;
}) {
  const [place, setPlace] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const placeNumber = Number(place);
  const validPlace = Number.isInteger(placeNumber) && placeNumber >= 1 && placeNumber <= MAX_PRIZE_PLACE;
  const replacing = validPlace && scope.prizes.some((prize) => prize.place === placeNumber);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validPlace || imageUrl.trim() === "") return;
    if (await onSet(placeNumber, imageUrl.trim())) {
      setPlace("");
      setImageUrl("");
    }
  };

  return (
    <section className="catalog-table-section">
      <div className="catalog-table-heading">
        <div><span className="eyebrow">Skin prizes by place</span><h2>Prizes</h2></div>
        <label className="field leaderboard-scope-picker">
          <span>Prizes of</span>
          <select value={scope.id} onChange={(event) => onSelectScope(event.target.value)}>
            {scopes.map((option) => <option key={option.id} value={option.id}>{option.name}{option.current ? " (current)" : ""}</option>)}
          </select>
        </label>
        <form className="leaderboard-prize-form" onSubmit={(event) => void submit(event)}>
          <label className="field"><span>Place</span><input type="number" min={1} max={MAX_PRIZE_PLACE} step={1} value={place} onChange={(event) => setPlace(event.target.value)} /></label>
          <label className="field"><span>Image URL</span><input type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://cdn.example.com/skins/awp.png" /></label>
          <button className="primary-action" type="submit" disabled={disabled || !validPlace || imageUrl.trim() === ""}>{replacing ? "Replace prize" : "Add prize"}</button>
        </form>
      </div>
      {scope.prizes.length === 0 ? (
        <div className="empty-state catalog-empty"><strong>No prizes</strong><span>Players see the prizes on the leaderboard as soon as they are set.</span></div>
      ) : (
        <div className="catalog-table-wrap">
          <table className="catalog-table leaderboard-table">
            <thead><tr><th>Place</th><th>Prize</th><th>Image URL</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {scope.prizes.map((prize) => (
                <tr key={prize.place}>
                  <td><strong>#{prize.place}</strong></td>
                  <td><img className="leaderboard-prize-image" src={prize.imageUrl} alt={`Prize for place ${prize.place}`} loading="lazy" /></td>
                  <td><span className="stream-url">{prize.imageUrl}</span></td>
                  <td>
                    <div className="row-actions">
                      <button className="row-actions__danger" type="button" disabled={disabled} onClick={() => onRemove(prize)}>Remove</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
