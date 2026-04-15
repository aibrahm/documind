import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Textarea matching the gridline design language.
 * Same treatment as Input — off-white bg, token border, ink focus.
 */
function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full px-3 py-2 text-sm outline-none transition-colors",
        "placeholder:text-[color:var(--ink-ghost)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{
        background: "var(--surface-raised)",
        color: "var(--ink)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        fontFamily: "var(--font-sans)",
        lineHeight: 1.55,
        ...(props.style ?? {}),
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLTextAreaElement).style.borderColor =
          "var(--ink)";
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLTextAreaElement).style.borderColor =
          "var(--border)";
        props.onBlur?.(e);
      }}
      {...props}
    />
  );
}

export { Textarea };
