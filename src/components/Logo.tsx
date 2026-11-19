/** Hodoor AI mark: a scan frame around a person silhouette. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0b1b3a" />
      <path
        d="M14 24V16h8M42 16h8v8M50 40v8h-8M22 48h-8v-8"
        stroke="#3b82f6"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="32" cy="29" r="7" fill="#fff" />
      <path d="M20 46c2-7 7-10 12-10s10 3 12 10" fill="#fff" />
    </svg>
  );
}
