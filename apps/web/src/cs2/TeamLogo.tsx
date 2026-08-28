import { useEffect, useState } from "react";

interface TeamLogoProps {
  name: string;
  src?: string;
}

export function TeamLogo({ name, src }: TeamLogoProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return (
    <span className="cs2-logo" aria-label={`${name} logo`}>
      {!failed && src ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span aria-hidden>{initials}</span>
      )}
    </span>
  );
}
