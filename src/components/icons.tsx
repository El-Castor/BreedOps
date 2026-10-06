import type { SVGProps } from "react";

// Minimal stroke icon set (24px grid, currentColor). Decorative by default.
const paths = {
  overview: "M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 4v3h6V4z",
  program:
    "M12 21c-4-3-7-6.5-7-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 14.5 16 18 12 21zM12 7V3",
  pedigree:
    "M6 4v5M6 9c0 4 6 3 6 7v4M18 4v5M18 9c0 4-6 3-6 7M4 4h4M16 4h4M10 20h4",
  phenotype: "M4 19h16M7 16V9M12 16V5M17 16v-4",
  inventory: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  operations: "M7 3v3M17 3v3M4 9h16M5 6h14v14H5zM9 13h2M13 13h2M9 16h2",
  users:
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c.6-3.4 3-5 6-5s5.4 1.6 6 5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 15c1.6.7 2.6 2.4 3 5",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0",
  leaf: "M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7",
  image:
    "M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 9.5a1 1 0 1 0 0-.01",
  menu: "M4 7h16M4 12h16M4 17h16",
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  ...props
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
