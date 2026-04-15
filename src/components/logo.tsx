// DocuMind logo — geometric icon (rotated square + circle) + wordmark.
// Concept: square = document, circle = mind.
// Typography: "docu" light (300) + "mind" bold (700).

type Size = "sm" | "md" | "lg" | "xl";
type Variant = "horizontal" | "stacked" | "icon";

interface LogoProps {
  variant?: Variant;
  size?: Size;
  className?: string;
  /** Accessible label — defaults to "DocuMind". */
  label?: string;
}

const ICON_SPECS: Record<Size, { container: number; square: number; circle: number; stroke: number }> = {
  sm: { container: 32, square: 22, circle: 11, stroke: 2 },
  md: { container: 48, square: 34, circle: 17, stroke: 2.5 },
  lg: { container: 64, square: 46, circle: 24, stroke: 3 },
  xl: { container: 96, square: 68, circle: 36, stroke: 4 },
};

const FONT_SIZES: Record<Size, number> = {
  sm: 18,
  md: 26,
  lg: 42,
  xl: 64,
};

const GAP: Record<Size, number> = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
};

export function DocuMindLogo({
  variant = "horizontal",
  size = "md",
  className = "",
  label = "DocuMind",
}: LogoProps) {
  const icon = ICON_SPECS[size];
  const fontSize = FONT_SIZES[size];

  // Icon SVG — a rotated square with a centered solid circle.
  // Built as a viewBox so the container size just scales it.
  const iconSvg = (
    <svg
      width={icon.container}
      height={icon.container}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <rect
        x="10"
        y="10"
        width="28"
        height="28"
        transform="rotate(45 24 24)"
        stroke="currentColor"
        strokeWidth={icon.stroke * (48 / icon.container)}
        fill="none"
      />
      <circle cx="24" cy="24" r="7" fill="currentColor" />
    </svg>
  );

  if (variant === "icon") {
    return (
      <span
        aria-label={label}
        role="img"
        className={className}
        style={{ display: "inline-flex", color: "currentColor" }}
      >
        {iconSvg}
      </span>
    );
  }

  const wordmark = (
    <span
      style={{
        fontSize,
        letterSpacing: "-0.025em",
        fontFamily: "var(--font-sans)",
        color: "currentColor",
        lineHeight: 1,
      }}
    >
      <span style={{ fontWeight: 300 }}>docu</span>
      <span style={{ fontWeight: 700 }}>mind</span>
    </span>
  );

  if (variant === "stacked") {
    return (
      <span
        aria-label={label}
        role="img"
        className={className}
        style={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          gap: GAP[size],
          color: "currentColor",
        }}
      >
        {iconSvg}
        {wordmark}
      </span>
    );
  }

  // horizontal (default)
  return (
    <span
      aria-label={label}
      role="img"
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: GAP[size],
        color: "currentColor",
      }}
    >
      {iconSvg}
      {wordmark}
    </span>
  );
}
