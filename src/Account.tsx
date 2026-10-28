import { FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import {
  AuthSession,
  ParkProfile,
  PlatformContext,
  backendConfigured,
  currentSession,
  getParkProfile,
  getPlatformContext,
  signIn,
  signOut,
  signUp,
  updateParkProfile,
  requestPasswordReset,
  updatePassword,
  supabase,
  clearOfflineParkCache,
  acceptParkInvitation,
  createParkInvitation,
  deactivateParkMember,
  listParkMembers,
  acceptEventStaffInvitation,
} from "./backend";
import { PARK_ROLES } from "./permissions";
import { clearCoordinatorSettings } from "./coordinator";
import { BrazilianPhoneInput, BrazilianStateOptions } from "./BrazilFields";

const INVITATION_KEY = "connect-pdm-pending-invitation";
const ConnectAdminConsole = lazy(() => import("./ConnectAdmin").then((module) => ({ default: module.ConnectAdminConsole })));

type AccountProps = {
  children: (props: {
    park: ParkProfile | null;
    onSignOut: () => Promise<void>;
    onSavePark: (park: ParkProfile) => Promise<void>;
  }) => React.ReactNode;
};

export function AccountGate({ children }: AccountProps) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [park, setPark] = useState<ParkProfile | null>(null);
  const [platformContext, setPlatformContext] =
    useState<PlatformContext | null>(null);
  const [loading, setLoading] = useState(backendConfigured);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState(false);
  const accountValidation = useRef(0);
  const connectRoute = window.location.pathname === "/connect" || window.location.pathname === "/connect/" || window.location.pathname.startsWith("/connect/");
  const authEntryRoute = window.location.pathname === "/entrar";

  async function loadAccount() {
    const validationId = ++accountValidation.current;
    setLoading(true);
    setError("");
    try {
      const active = await currentSession();
      if (validationId !== accountValidation.current) return;
      setSession(null);
      setPark(null);
      setPlatformContext(null);
      if (
        (window.location.hash.includes("type=recovery") ||
          new URLSearchParams(window.location.search).has(
            "passwordRecovery",
          )) &&
        active
      )
        setRecovery(true);
      if (!active) {
        setPark(null);
        setPlatformContext(null);
        return;
      }
      const eventInvite = new URLSearchParams(window.location.search).get(
        "eventInvite",
      );
      if (eventInvite) {
        await acceptEventStaffInvitation(eventInvite);
        if (validationId !== accountValidation.current) return;
        window.history.replaceState(null, "", window.location.pathname);
      }
      const invite = localStorage.getItem(INVITATION_KEY);
      if (invite) {
        await acceptParkInvitation(invite);
        if (validationId !== accountValidation.current) return;
        localStorage.removeItem(INVITATION_KEY);
      }
      const [nextPlatform, nextPark] = await Promise.all([
        getPlatformContext(),
        getParkProfile(),
      ]);
      const stillActive = await currentSession();
      if (validationId !== accountValidation.current || !stillActive || stillActive.user.id !== active.user.id) {
        setSession(null);
        setPark(null);
        setPlatformContext(null);
        return;
      }
      setSession(stillActive);
      setPlatformContext(nextPlatform);
      setPark(nextPark);
    } catch (reason) {
      if (validationId !== accountValidation.current) return;
      setSession(null);
      setPark(null);
      setPlatformContext(null);
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível carregar a conta.",
      );
    } finally {
      if (validationId === accountValidation.current) setLoading(false);
    }
  }
  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (invite) {
      localStorage.setItem(INVITATION_KEY, invite);
      window.history.replaceState(null, "", window.location.pathname);
    }
    if (backendConfigured) void loadAccount();
  }, []);
  useEffect(() => {
    if (!backendConfigured) return;
    const revalidate = () => {
      void loadAccount();
    };
    window.addEventListener("online", revalidate);
    return () => window.removeEventListener("online", revalidate);
  }, []);
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, active) => {
      if (event === "SIGNED_OUT") {
        accountValidation.current += 1;
        setSession(null);
        setPark(null);
        setPlatformContext(null);
        setRecovery(false);
        setLoading(false);
        clearOfflineParkCache();
        clearCoordinatorSettings();
      }
      if (event === "PASSWORD_RECOVERY") {
        accountValidation.current += 1;
        setSession(active);
        setPark(null);
        setRecovery(true);
        setLoading(false);
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        setSession(null);
        setPark(null);
        setPlatformContext(null);
        void loadAccount();
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (authEntryRoute && session && park && !loading) window.location.replace("/operacao");
  }, [authEntryRoute, session, park, loading]);

  async function handleSignOut() {
    accountValidation.current += 1;
    setSession(null);
    setPark(null);
    setPlatformContext(null);
    setMessage("");
    clearOfflineParkCache();
    clearCoordinatorSettings();
    try {
      await signOut();
    } catch (error) {
      if (navigator.onLine) throw error;
    } finally {
      clearOfflineParkCache();
    }
  }
  async function handleSavePark(value: ParkProfile) {
    await updateParkProfile(value);
    setPark(value);
  }
  const invitationMode = Boolean(
    !connectRoute &&
      (new URLSearchParams(window.location.search).has("eventInvite") ||
        new URLSearchParams(window.location.search).has("invite") ||
        localStorage.getItem(INVITATION_KEY)),
  );

  if (!backendConfigured)
    return (
      <AccountShell>
        <div className="account-card card form-card">
          <h2>Área protegida indisponível</h2>
          <p>Configure e valide o Supabase Auth para autenticar uma conta e consultar as permissões reais no servidor. O modo local deste aparelho não autentica usuários nem concede acesso a áreas internas.</p>
          <a className="secondary" href="/eventos">Voltar ao site público</a>
        </div>
      </AccountShell>
    );

  if (loading)
    return (
      <AccountShell>
        <div className="empty">Conferindo sessão segura…</div>
      </AccountShell>
    );
  if (recovery && session)
    return (
      <ResetPassword
        onDone={async () => {
          await handleSignOut();
          setRecovery(false);
          window.history.replaceState(null, "", window.location.pathname);
        }}
      />
    );
  const canAccessPlatform = Boolean(
    session &&
    platformContext &&
    ["platform_admin", "deployment", "support"].includes(platformContext.role),
  );
  if (connectRoute && session && platformContext && canAccessPlatform)
    return (
      <Suspense fallback={<AccountShell><div className="empty" role="status">Carregando painel administrativo...</div></AccountShell>}>
        <ConnectAdminConsole context={platformContext} onSignOut={handleSignOut} />
      </Suspense>
    );
  if (connectRoute && session && error)
    return (
      <AccountShell>
        <div className="account-card card form-card">
          <h2>Não foi possível validar o acesso Connect</h2>
          <p>{error}</p>
          <button className="secondary" onClick={() => { setLoading(true); void loadAccount(); }}>Tentar novamente</button>
          <button className="text-button" onClick={handleSignOut}>Sair</button>
        </div>
      </AccountShell>
    );
  if (connectRoute && session && !canAccessPlatform)
    return (
      <AccountShell>
        <div className="account-card card form-card">
          <h2>Acesso administrativo não autorizado</h2>
          <p>Esta conta não possui uma função administrativa Connect ativa. O acesso ao painel do parque não concede acesso administrativo à plataforma.</p>
          <button className="text-button" onClick={handleSignOut}>Sair</button>
        </div>
      </AccountShell>
    );
  if (session && park && !connectRoute)
    return (
      <>
        {children({
          park,
          onSignOut: handleSignOut,
          onSavePark: handleSavePark,
        })}
      </>
    );
  if (session && error)
    return (
      <AccountShell>
        <div className="account-card card form-card">
          <h2>Não foi possível validar o parque</h2>
          <p>{error}</p>
          <button
            className="secondary"
            onClick={() => {
              setLoading(true);
              void loadAccount();
            }}
          >
            Tentar novamente
          </button>
          <button className="text-button" onClick={handleSignOut}>
            Sair
          </button>
        </div>
      </AccountShell>
    );
  if (session)
    return (
      <AccountShell>
        <div className="account-card card form-card">
          <h2>{canAccessPlatform ? "Acesso administrativo Connect" : "Acesso ainda não associado"}</h2>
          <p>{canAccessPlatform
            ? "A área administrativa da plataforma fica no endereço /connect."
            : "Esta conta não possui parque ou evento ativo. Solicite um convite à administração do parque ou da Connect Vaquejada."}</p>
          {error && (
            <div className="account-error" role="alert">
              {error}
            </div>
          )}
          <button
            className="secondary"
            onClick={() => {
              setLoading(true);
              void loadAccount();
            }}
          >
            Verificar novamente
          </button>
          {canAccessPlatform && <a className="secondary" href="/connect">Abrir painel Connect</a>}
          <button className="text-button" onClick={handleSignOut}>
            Sair
          </button>
        </div>
      </AccountShell>
    );
  return (
    <AuthForm
      error={error}
      message={message}
      setError={setError}
      setMessage={setMessage}
      onReset={async (email) => {
        await requestPasswordReset(email);
      }}
      onAuthenticated={async (active) => {
        const eventInvite = new URLSearchParams(window.location.search).get(
          "eventInvite",
        );
        if (eventInvite) {
          await acceptEventStaffInvitation(eventInvite);
          window.history.replaceState(null, "", window.location.pathname);
        }
        const invite = localStorage.getItem(INVITATION_KEY);
        if (invite) {
          await acceptParkInvitation(invite);
          localStorage.removeItem(INVITATION_KEY);
        }
        const [nextPlatform, nextPark] = await Promise.all([
          getPlatformContext(),
          getParkProfile(),
        ]);
        setPlatformContext(nextPlatform);
        setPark(nextPark);
        setSession(active);
      }}
      invitationMode={invitationMode}
    />
  );
}

function AuthForm({
  error,
  message,
  setError,
  setMessage,
  onAuthenticated,
  onReset,
  invitationMode = false,
  disabled = false,
}: {
  error: string;
  message: string;
  setError: (value: string) => void;
  setMessage: (value: string) => void;
  onAuthenticated: (session: AuthSession) => Promise<void>;
  onReset: (email: string) => Promise<void>;
  invitationMode?: boolean;
  disabled?: boolean;
}) {
  const [register, setRegister] = useState(invitationMode);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    if (disabled) {
      setError(
        "O backend do Connect PDM ainda não está configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY e recarregue a página.",
      );
      setBusy(false);
      return;
    }
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    try {
      if (forgot) {
        await onReset(email);
        setMessage(
          "Se houver uma conta para este email, enviaremos instruções de redefinição.",
        );
        return;
      }
      if (!register) {
        await onAuthenticated(await signIn(email, password));
        return;
      }
      const created = await signUp(email, password);
      if (!created.session) {
        setMessage(
          localStorage.getItem(INVITATION_KEY)
            ? "Conta criada. Confirme o email e depois entre por este navegador para aceitar o convite do parque."
            : "Conta criada. Confirme o email e depois entre por este link para ativar o convite do evento.",
        );
        setRegister(false);
        return;
      }
      await onAuthenticated(created.session);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível concluir o acesso.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <AccountShell>
      <form className="account-card card form-card" onSubmit={submit}>
        <div className="card-heading">
          <div className="icon-box">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h2>
              {register
                ? "Ativar convite"
                : forgot
                ? "Redefinir senha"
                : "Acessar o Connect PDM"}
            </h2>
            <p>
              {register
                ? "Use o email que recebeu o convite para criar sua senha e ativar o acesso autorizado."
                : "O acesso ao parque e ao evento depende de convite autorizado no servidor."}
            </p>
          </div>
        </div>
        <AccountField label="Email de acesso">
          <input name="email" type="email" required autoComplete="email" />
        </AccountField>
        {!forgot && (
          <AccountField label="Senha">
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={register ? "new-password" : "current-password"}
            />
          </AccountField>
        )}
        {error && (
          <div className="account-error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className="account-message" role="status">
            {message}
          </div>
        )}
        <button className="primary" disabled={busy || disabled} type="submit">
          <LogIn size={16} />
          {busy
            ? "Aguarde…"
            : register
              ? "Criar senha e ativar convite"
              : forgot
                ? "Enviar instruções"
                : "Entrar"}
        </button>
        {!register && !forgot && (
          <button
            className="text-button"
            type="button"
            disabled={disabled}
            onClick={() => {
              setForgot(true);
              setMessage("");
              setError("");
            }}
          >
            Esqueci minha senha
          </button>
        )}
        {invitationMode && (
          <button
            className="text-button"
            type="button"
            disabled={disabled}
            onClick={() => {
              setRegister(!register);
              setForgot(false);
              setError("");
              setMessage("");
            }}
          >
            {register || forgot ? "Já tenho conta · Entrar" : "Ativar convite"}
          </button>
        )}
      </form>
    </AccountShell>
  );
}

function ResetPassword({ onDone }: { onDone: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AccountShell>
      <form
        className="account-card card form-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(event.currentTarget);
          try {
            await updatePassword(String(data.get("password") || ""));
            await onDone();
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Não foi possível redefinir a senha.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="card-heading">
          <div className="icon-box">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h2>Escolha uma nova senha</h2>
            <p>Depois, entre novamente com a nova senha.</p>
          </div>
        </div>
        <AccountField label="Nova senha">
          <input
            name="password"
            type="password"
            minLength={8}
            autoComplete="new-password"
            required
          />
        </AccountField>
        {error && (
          <div className="account-error" role="alert">
            {error}
          </div>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Salvando…" : "Atualizar senha"}
        </button>
      </form>
    </AccountShell>
  );
}

export function ParkEditor({
  park,
  onSave,
}: {
  park: ParkProfile;
  onSave: (value: ParkProfile) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [state, setState] = useState(park.state);
  return (
    <form
      className="card form-card park-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setNotice("");
        const form = new FormData(event.currentTarget);
        try {
          await onSave({
            ...park,
            name: String(form.get("name")).trim(),
            manager_name: String(form.get("manager_name")).trim(),
            phone: String(form.get("phone")).trim(),
            city: String(form.get("city")).trim(),
            state: String(form.get("state")).trim().toUpperCase(),
            address: String(form.get("address")).trim(),
          });
          setNotice("Dados do parque atualizados.");
        } catch (reason) {
          setNotice(
            reason instanceof Error ? reason.message : "Falha ao salvar.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="card-heading">
        <div className="icon-box">
          <ShieldCheck size={20} />
        </div>
        <div>
          <h2>Dados do parque</h2>
          <p>A conta autenticada administra este parque.</p>
        </div>
      </div>
      <div className="park-editor-section-title"><h3>Identificação do parque</h3><p>Nome oficial e pessoa responsável pelo cadastro.</p></div>
      <div className="form-row">
        <AccountField label="Nome do parque">
          <input name="name" required defaultValue={park.name} />
        </AccountField>
        <AccountField label="Responsável">
          <input
            name="manager_name"
            required
            defaultValue={park.manager_name}
          />
        </AccountField>
      </div>
      <div className="form-row">
        <AccountField label="Telefone">
          <BrazilianPhoneInput required defaultValue={park.phone} state={state} />
        </AccountField>
        <AccountField label="Cidade">
          <input name="city" required defaultValue={park.city} />
        </AccountField>
      </div>
      <div className="park-editor-section-title"><h3>Localização</h3><p>Endereço e município para contato e identificação.</p></div>
      <div className="form-row">
        <AccountField label="Estado (UF)">
          <select name="state" required value={state} onChange={(event) => setState(event.target.value)}>
            <option value="">Selecione a UF</option>
            {BrazilianStateOptions()}
          </select>
        </AccountField>
        <AccountField label="Endereço">
          <input name="address" required defaultValue={park.address} />
        </AccountField>
      </div>
      {notice && (
        <div className="account-message" role="status">
          {notice}
        </div>
      )}
      <button className="primary" disabled={busy}>
        {busy ? "Salvando…" : "Salvar alterações"}
      </button>
    </form>
  );
}

export function TeamManager({ park }: { park: ParkProfile }) {
  const [members, setMembers] = useState<
    Awaited<ReturnType<typeof listParkMembers>>
  >([]);
  const [notice, setNotice] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setMembers(await listParkMembers());
  }
  useEffect(() => {
    if (park.access_role === "park_manager")
      void refresh().catch((error: unknown) =>
        setNotice(
          error instanceof Error
            ? error.message
            : "Falha ao carregar usuários.",
        ),
      );
  }, [park.id, park.access_role]);
  if (park.access_role !== "park_manager")
    return (
      <section className="card form-card">
        <h2>Equipe</h2>
        <p>Somente o responsável do parque pode administrar acessos.</p>
      </section>
    );
  return (
    <section className="card form-card park-team-manager">
      <div className="card-heading">
        <div>
          <h2>Usuários do parque</h2>
          <p>
            Crie acessos individuais para escritório, locução, pista e
            responsáveis. Cada perfil entra com seu próprio email e pode acessar
            a área correta do sistema.
          </p>
        </div>
      </div>
      <form
        className="park-invite-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setNotice("");
          setInviteUrl("");
          const form = new FormData(event.currentTarget);
          try {
            const invitation = await createParkInvitation(
              String(form.get("email") || ""),
              String(
                form.get("role") || "office",
              ) as ParkProfile["access_role"],
            );
            const url = new URL(window.location.href);
            url.search = "";
            url.hash = "";
            url.searchParams.set("invite", invitation.invitation_token);
            setInviteUrl(url.toString());
            setNotice(
              `Convite válido até ${new Date(invitation.expires_at).toLocaleString()}. Envie este link ao destinatário por canal confiável.`,
            );
            await refresh();
          } catch (error) {
            setNotice(
              error instanceof Error
                ? error.message
                : "Falha ao criar convite.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <AccountField label="Email individual">
          <input name="email" type="email" required />
        </AccountField>
        <AccountField label="Perfil do parque">
          <select name="role" defaultValue="office">
            {PARK_ROLES.map((role) => (
              <option key={role} value={role}>
                {role === "park_manager"
                  ? "Responsável pelo parque"
                  : role === "office"
                    ? "Escritório"
                    : role === "announcer"
                      ? "Locução"
                      : role === "judge"
                        ? "Julgador"
                        : "Operador de pista"}
              </option>
            ))}
          </select>
        </AccountField>
        <button className="primary" disabled={busy}>
          {busy ? "Criando…" : "Criar convite"}
        </button>
      </form>
      {inviteUrl && (
        <textarea readOnly value={inviteUrl} aria-label="Link de convite" />
      )}
      {notice && <p role="status">{notice}</p>}
      <h3>Acessos</h3>
      <ul className="park-member-list">
        {members.map((member) => (
          <li key={member.user_id} className="park-member-row">
            <span className="park-member-identity">
            {member.user_id} · {member.role} ·{" "}
            {member.disabled_at ? "Desativado" : "Ativo"}
            </span>
            {!member.disabled_at && (
              <button
                className="text-button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await deactivateParkMember(member.user_id);
                    await refresh();
                  } catch (error) {
                    setNotice(
                      error instanceof Error
                        ? error.message
                        : "Falha ao desativar.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Desativar
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AccountField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function AccountShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="account-shell">
      <div className="account-brand">
        <img
          className="brand-mark"
          src="/Simbolo-Principal-Connect-Vaquejada.png"
          alt="Connect Vaquejada"
        />
        <div>
          <strong>CONNECT VAQUEJADA</strong>
          <span>Tradição na pista. Conexão em cada resultado.</span>
        </div>
      </div>
      {children}
      <a className="account-public-events-link" href="/eventos">Consultar eventos públicos</a>
      <footer>
        Os dados do parque são protegidos pela sessão autenticada e pelas
        políticas do banco.
      </footer>
    </main>
  );
}
