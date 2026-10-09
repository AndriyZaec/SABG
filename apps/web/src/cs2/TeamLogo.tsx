import { useEffect, useState } from "react";

interface TeamLogoProps {
  name: string;
  src?: string;
  fallback?: "initials" | "trophy";
}

export function TeamLogo({ name, src, fallback = "initials" }: TeamLogoProps) {
  const [failed, setFailed] = useState(false);
  const isPlaceholder = fallback === "trophy" && src?.endsWith("/tournament-logos/generic");

  useEffect(() => setFailed(false), [src]);

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return (
    <span className="cs2-logo" aria-label={`${name} logo`}>
      {!failed && src && !isPlaceholder ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : fallback === "trophy" ? (
        <svg className="cs2-logo__trophy" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 3h8v7a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v7M8 21h8" />
        </svg>
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </span>
  );
}
