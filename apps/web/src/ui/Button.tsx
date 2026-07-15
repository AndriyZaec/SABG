import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "survive" | "danger" | "plain";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  block?: boolean;
  lg?: boolean;
  children: ReactNode;
}

export function Button({ variant = "primary", block, lg, className = "", children, ...rest }: ButtonProps) {
  const classes = [
    "nb-btn",
    `nb-btn--${variant}`,
    block ? "nb-btn--block" : "",
    lg ? "nb-btn--lg" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  );
}
