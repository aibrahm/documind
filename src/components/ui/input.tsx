import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@/lib/utils";

/**
 * Text input matching the gridline design language.
 *
 * - Background: --surface-raised (off-white)
 * - Border: 1px --border token, focus→ --ink
 * - Radius: --radius-md (sharp but not razor)
 * - No soft colored ring — the border darkens to ink on focus, matches
 *   the rest of the app where active = solid ink.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 px-3 py-1.5 text-sm outline-none transition-colors",
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
        ...(props.style ?? {}),
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLInputElement).style.borderColor = "var(--ink)";
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLInputElement).style.borderColor =
          "var(--border)";
        props.onBlur?.(e);
      }}
      {...props}
    />
  );
}

export { Input };
