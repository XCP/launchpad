"use client";

import type { ButtonHTMLAttributes } from "react";

const VARIANTS = {
  // Disabled stays purple, just dimmed — "hasn't been filled in yet" should
  // never read as "broken" or "off". Gray was doing that: a form with
  // nothing typed into it looked dead rather than merely not-yet-ready.
  primary:
    "bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 disabled:hover:bg-purple-600",
  dark: "bg-gray-900 text-white hover:bg-gray-700",
  danger: "bg-red-600 text-white hover:bg-red-500",
} as const;

const SIZES = {
  lg: "rounded-2xl px-5 py-3.5",
  md: "rounded-xl px-5 py-2.5",
} as const;

/** The full-width call-to-action every form ends with. */
export function CTA({
  variant = "primary",
  size = "lg",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
}) {
  return (
    <button
      type="button"
      {...props}
      className={`w-full font-medium transition-all active:scale-[0.99] disabled:cursor-not-allowed ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
    />
  );
}
