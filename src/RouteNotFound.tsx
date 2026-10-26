import { ArrowLeft } from "lucide-react";
import { PageHeading } from "./PageHeading";

export function RouteNotFound({ home = "/" }: { home?: string }) {
  return <main className="route-not-found">
    <PageHeading eyebrow="CONNECT VAQUEJADA" title="Página não encontrada" />
    <p>O endereço não corresponde a uma página disponível.</p>
    <a className="secondary" href={home}><ArrowLeft size={16} /> Voltar</a>
  </main>;
}
