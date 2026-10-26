import { ReactNode } from "react";
import { ArrowRight, Info } from "lucide-react";

export function AdminSectionHeader({ id, eyebrow, title, description, actions }: {
  id?: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return <header className="connect-admin-section-header">
    <div>
      {eyebrow && <span className="connect-admin-section-eyebrow">{eyebrow}</span>}
      <h2 id={id}>{title}</h2>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="connect-admin-section-actions">{actions}</div>}
  </header>;
}

export function AdminStateCard({ title, children, action, tone = "info" }: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  tone?: "info" | "error";
}) {
  return <section className={`connect-admin-state-card ${tone}`} role={tone === "error" ? "alert" : undefined}>
    <Info size={19} aria-hidden="true" />
    <div><h2>{title}</h2><p>{children}</p>{action && <div className="connect-admin-state-action">{action}</div>}</div>
  </section>;
}

export function AdminGoToParks({ onClick }: { onClick: () => void }) {
  return <button className="secondary" type="button" onClick={onClick}>Ir para parques <ArrowRight size={15} /></button>;
}
