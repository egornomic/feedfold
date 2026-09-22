interface BrandIdentityProps {
  className?: string;
  decorative?: boolean;
}

export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-logo${className ? ` ${className}` : ""}`} aria-hidden="true">
      <svg viewBox="14 14 72 72" focusable="false">
        <title>Feedfold Balanced Grid logo</title>
        <rect x="18" y="18" width="18" height="18" rx="4" />
        <rect x="41" y="18" width="18" height="18" rx="4" />
        <rect x="64" y="18" width="18" height="18" rx="4" />
        <rect x="18" y="41" width="18" height="18" rx="4" />
        <rect x="41" y="41" width="18" height="18" rx="4" />
        <rect x="18" y="64" width="18" height="18" rx="4" />
      </svg>
    </span>
  );
}

export function BrandIdentity({ className = "", decorative = false }: BrandIdentityProps) {
  return (
    <span
      className={`brand-identity${className ? ` ${className}` : ""}`}
      aria-hidden={decorative || undefined}
    >
      <BrandLogo />
      <span className="brand-wordmark">feedfold</span>
    </span>
  );
}
