import type { ReactNode } from "react";

// The shared, content-sized announcement slot. Removing it leaves no reserved space.
export function TemporaryCta({ title, titleId, action, children, className = "" }: {
  title: ReactNode;
  titleId: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <aside className={`temporary-cta ${className}`.trim()} aria-labelledby={titleId}>
    <div className="temporary-cta-heading"><h2 id={titleId}>{title}</h2>{action}</div>
    {children}
  </aside>;
}
