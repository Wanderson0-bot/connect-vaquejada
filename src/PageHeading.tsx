import { ReactNode } from "react";

type PageHeadingProps = {
  eyebrow: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeading({ eyebrow, title, description, actions, className = "" }: PageHeadingProps) {
  return <div className={`page-heading ${className}`.trim()}>
    <div className="page-heading-copy">
      <div className="page-heading-eyebrow eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      {description && <p className="page-heading-description">{description}</p>}
    </div>
    {actions && <div className="page-heading-actions">{actions}</div>}
  </div>;
}
