import type { StreamEmbed } from "../stream/streamEmbed.js";

export function StageStream({ embed }: { embed?: StreamEmbed }) {
  return (
    <div className="cs2-stage__stream">
      {embed ? (
        <iframe
          className="cs2-stage__frame"
          src={embed.src}
          title={`${embed.label} live stream`}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div className="cs2-stage__stream-placeholder">
          <span className="cs2-stage__stream-mark" aria-hidden="true">▶</span>
          <p>Match stream</p>
          <span>Waiting for the match broadcast.</span>
        </div>
      )}
    </div>
  );
}
