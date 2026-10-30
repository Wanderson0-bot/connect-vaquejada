import { FormEvent, lazy, Suspense, useEffect, useRef, useState } from "react";
import { LogIn, ShieldCheck } from "lucide-react";
import {
  AuthSession,
  ParkProfile,
  PlatformContext,
  backendConfigured,
  authProjectRef,
  currentSession,
  getParkProfile,
  getPlatformContext,
  signIn,
  signOut,
  signUp,
  registerConnectAdminAccount,
  resendSignupConfirmation,
  updateParkProfile,
  requestPasswordReset,
  updatePassword,
  clearOfflineParkCache,
  acceptParkInvitation,
  createParkInvitation,
  deactivateParkMember,
  listParkMembers,
  acceptEventStaffInvitation,
} from "./backend";
import { clearCoordinatorSettings } from "./coordinator";
import { BrazilianPhoneInput, BrazilianStateOptions } from "./BrazilFields";

const INVITATION_KEY = "connect-pdm-pending-invitation";
const EVENT_INVITATION_KEY = "connect-pdm-pending-event-invitation";
const ConnectAdminConsole = lazy(() => import("./ConnectAdmin").then((module) => ({ default: module.ConnectAdminConsole })));

async function acceptPendingParkInvitation(token: string) {
  try {
    await acceptParkInvitation(token);
  } catch (reason) {
    const code = typeof reason === "object" && reason !== null && "code" in reason
      ? String((reason as { code?: unknown }).code || "") : "";
    const message = reason instanceof Error ? reason.message : "";
    if (code === "42501" && message.toLowerCase().includes("invitation invalid, expired, revoked")) {
      localStorage.removeItem(INVITATION_KEY);
      throw new Error("O convite é inválido, expirou, foi revogado ou foi enviado para outro email. Confirme que entrou com o email convidado. Se o erro continuar, peça ao responsável um novo link de convite.");
    }
    throw reason;
  }
}

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
  const connectRegistrationRoute = window.location.pathname === "/connect/cadastro";
  const connectLoginRoute = window.location.pathname === "/connect" || window.location.pathname === "/connect/";
  const authEntryRoute = window.location.pathname === "/entrar";

  async function loadAccount() {
    const validationId = ++accountValidation.current;
    setLoading(true);
    setError("");
    try {
      const active = await currentSession();
      const recoveryToken = new URLSearchParams(window.location.search).get("token");
      if (validationId !== accountValidation.current) return;
      setSession(null);
      setPark(null);
      setPlatformContext(null);
      if (recoveryToken) setRecovery(true);
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
      if (!connectRoute) {
        const eventInvite = localStorage.getItem(EVENT_INVITATION_KEY);
        if (eventInvite) {
          await acceptEventStaffInvitation(eventInvite);
          if (validationId !== accountValidation.current) return;
          localStorage.removeItem(EVENT_INVITATION_KEY);
        }
        const invite = localStorage.getItem(INVITATION_KEY);
        if (invite) {
          await acceptPendingParkInvitation(invite);
          if (validationId !== accountValidation.current) return;
          localStorage.removeItem(INVITATION_KEY);
        }
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
    const params = new URLSearchParams(window.location.search);
    const eventInvite = params.get("eventInvite");
    if (eventInvite) {
      if (!connectRoute) localStorage.setItem(EVENT_INVITATION_KEY, eventInvite);
      params.delete("eventInvite");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (invite) {
      if (!connectRoute) localStorage.setItem(INVITATION_KEY, invite);
      const cleanParams = new URLSearchParams(window.location.search);
      cleanParams.delete("invite");
      const query = cleanParams.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
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
    if (!backendConfigured) return;
    const revalidate = () => void loadAccount();
    window.addEventListener("connect-auth-statechange", revalidate);
    window.addEventListener("focus", revalidate);
    return () => {
      window.removeEventListener("connect-auth-statechange", revalidate);
      window.removeEventListener("focus", revalidate);
    };
  }, []);
  useEffect(() => {
    if (!authEntryRoute || !session || loading) return;
    if (platformContext && ["platform_admin", "deployment", "support"].includes(platformContext.role)) {
      window.location.replace("/connect");
      return;
    }
    if (park) window.location.replace("/operacao");
  }, [authEntryRoute, session, park, platformContext, loading]);

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
      (localStorage.getItem(EVENT_INVITATION_KEY) ||
        localStorage.getItem(INVITATION_KEY)),
  );

  if (!backendConfigured)
    return (
      <AccountShell>
        <div className="account-card card form-card">
          <h2>Área protegida indisponível</h2>
          <p>Configure VITE_BACKEND_API_URL e VITE_NEON_DATA_API_URL para acessar a autenticação Connect e as permissões reais no servidor. O modo local deste aparelho não autentica usuários nem concede acesso a áreas internas.</p>
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
  const recoveryToken = new URLSearchParams(window.location.search).get("token") || "";
  if (recovery && (session || recoveryToken))
    return (
      <ResetPassword
        token={recoveryToken}
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
            ? "Sua conta tem acesso administrativo à plataforma. Abra o painel Connect para cadastrar e administrar parques."
            : "Esta conta ainda não tem vínculo ativo com um parque ou evento. Peça à equipe responsável um convite de acesso."}</p>
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
      connectRoute={connectRoute}
      connectRegistrationRoute={connectRegistrationRoute}
      showConnectCreateAccount={connectLoginRoute}
      setError={setError}
      setMessage={setMessage}
      onReset={async (email) => {
        await requestPasswordReset(email);
      }}
      onAuthenticated={async (active) => {
        if (!connectRoute) {
          const eventInvite = localStorage.getItem(EVENT_INVITATION_KEY);
          if (eventInvite) {
            await acceptEventStaffInvitation(eventInvite);
            localStorage.removeItem(EVENT_INVITATION_KEY);
          }
          const invite = localStorage.getItem(INVITATION_KEY);
          if (invite) {
            await acceptPendingParkInvitation(invite);
            localStorage.removeItem(INVITATION_KEY);
          }
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
  connectRoute = false,
  connectRegistrationRoute = false,
  showConnectCreateAccount = false,
  onAuthenticated,
  onReset,
  invitationMode = false,
  disabled = false,
}: {
  error: string;
  message: string;
  connectRoute?: boolean;
  connectRegistrationRoute?: boolean;
  showConnectCreateAccount?: boolean;
  setError: (value: string) => void;
  setMessage: (value: string) => void;
  onAuthenticated: (session: AuthSession) => Promise<void>;
  onReset: (email: string) => Promise<void>;
  invitationMode?: boolean;
  disabled?: boolean;
}) {
  // Park/event invitation activation stays scoped to its existing access flow;
  // Connect registration has its own route and accepts only bootstrap tokens.
  const canActivateInvitation = !connectRoute && invitationMode;
  const [register, setRegister] = useState(canActivateInvitation || connectRegistrationRoute);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    if (disabled) {
      setError(
        "O backend do Connect ainda não está configurado. Defina VITE_BACKEND_API_URL e VITE_NEON_DATA_API_URL e recarregue a página.",
      );
      setBusy(false);
      return;
    }
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const fullName = String(form.get("fullName") || "").trim();
    const confirmationPassword = String(form.get("confirmationPassword") || "");
    try {
      if (forgot) {
        await onReset(email);
        setMessage(
          "Se houver uma conta para este email, enviaremos instruções de redefinição.",
        );
        return;
      }
      if (!register || !canActivateInvitation) {
        if (connectRegistrationRoute && register) {
          if (fullName.length < 3 || fullName.length > 100) throw new Error("Informe seu nome completo.");
          if (password !== confirmationPassword) throw new Error("A confirmação da senha não corresponde.");
          const created = await registerConnectAdminAccount(fullName, email, password, confirmationPassword);
          window.history.replaceState(null, "", window.location.pathname);
          if (!created.session) {
            setPendingConfirmationEmail(email);
            setMessage("Cadastro recebido. Confirme seu email pelo link enviado para concluir a ativação da conta.");
            setRegister(false);
            return;
          }
          await onAuthenticated(created.session);
          return;
        }
        await onAuthenticated(await signIn(email, password));
        return;
      }
      const created = await signUp(email, password);
      if (!created.session) {
        if (created.existingAccount) {
          setPendingConfirmationEmail("");
          setMessage("Esta conta já pode estar cadastrada. Entre com seu email ou use “Esqueci minha senha” para recuperar o acesso.");
        } else {
          setPendingConfirmationEmail(email);
          setMessage("Cadastro recebido. A entrega do email depende da configuração do serviço de envio. Confira a caixa de entrada e o spam; se não chegar, solicite outro email abaixo.");
        }
        setRegister(false);
        return;
      }
      await onAuthenticated(created.session);
    } catch (reason) {
      const code = typeof reason === "object" && reason !== null && "code" in reason
        ? String((reason as { code?: unknown }).code || "")
        : "";
      if (["invalid_credentials", "invalid_email_or_password"].includes(code.toLowerCase())) {
        setError(connectRoute
          ? `Email ou senha incorretos para o ${authProjectRef}. Confira se o navegador não preencheu uma senha antiga.`
          : canActivateInvitation
            ? "Email ou senha incorretos. Se ainda não criou a senha, volte para ‘Ativar convite’. Use o mesmo email que recebeu o convite."
            : "Email ou senha incorretos. Confira os dados ou use ‘Esqueci minha senha’ para redefinir a senha.");
      } else if (["email_not_confirmed", "email_not_verified"].includes(code.toLowerCase())) {
        setError("Confirme seu email pelo link enviado e tente entrar novamente.");
      } else {
        setError(
          reason instanceof Error
            ? reason.message
            : "Não foi possível concluir o acesso.",
        );
      }
    } finally {
      setBusy(false);
    }
  }
  async function resendConfirmation() {
    if (!pendingConfirmationEmail) return;
    setBusy(true);
    setError("");
    try {
      await resendSignupConfirmation(pendingConfirmationEmail);
      setMessage(`Solicitação de reenvio aceita para ${pendingConfirmationEmail}. Confira também o spam.`);
    } catch (reason) {
      const code = typeof reason === "object" && reason !== null && "code" in reason
        ? String((reason as { code?: unknown }).code || "") : "";
      setError(code === "over_email_send_rate_limit"
        ? "O limite de envio de emails foi atingido. Aguarde antes de tentar novamente."
        : code === "email_address_not_authorized"
          ? "O serviço de email não autorizou esse destinatário. Confira a configuração do domínio remetente."
          : reason instanceof Error ? reason.message : "O serviço de autenticação não aceitou o reenvio. Confira a configuração de email.");
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
                ? connectRegistrationRoute ? "Criar conta Connect" : "Ativar convite"
                : forgot
                ? "Redefinir senha"
                : connectRoute ? "Entrar no painel Connect" : "Acessar o Connect PDM"}
            </h2>
            <p>
              {register
                ? connectRegistrationRoute ? "Crie sua conta administrativa Connect com seus dados de acesso." : "Use o email que recebeu o convite para criar sua senha e ativar o acesso autorizado."
                : connectRoute
                  ? "Entre com a conta autorizada da equipe Connect. O sistema confirma sua função antes de abrir o painel."
                  : "Entre com sua conta Connect. Depois de validar suas permissões, o sistema abrirá a área disponível para você."}
            </p>
          </div>
        </div>
        {register && connectRegistrationRoute && <AccountField label="Nome completo"><input name="fullName" type="text" required minLength={3} maxLength={100} autoComplete="name" /></AccountField>}
        <AccountField label="Email de acesso">
          <input name="email" type="email" required autoComplete="email" />
        </AccountField>
        {!forgot && (
          <AccountField label="Senha">
            <input
              name="password"
              type="password"
              required
              minLength={10}
              autoComplete={register ? "new-password" : "current-password"}
            />
          </AccountField>
        )}
        {register && connectRegistrationRoute && !forgot && <AccountField label="Confirme sua senha"><input name="confirmationPassword" type="password" required minLength={10} autoComplete="new-password" /></AccountField>}
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
        {pendingConfirmationEmail && (!connectRoute || connectRegistrationRoute) && !register && !forgot && <button className="text-button" type="button" disabled={busy || disabled} onClick={() => void resendConfirmation()}>Reenviar email de confirmação para {pendingConfirmationEmail}</button>}
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
        {showConnectCreateAccount && !register && !forgot && <a className="text-button" href="/connect/cadastro">Criar conta</a>}
        {connectRegistrationRoute && <a className="text-button" href="/connect">{register ? "JÃ¡ tenho conta · Entrar" : "Voltar ao login Connect"}</a>}
        {canActivateInvitation && (
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

function ResetPassword({ token, onDone }: { token: string; onDone: () => Promise<void> }) {
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
            await updatePassword(String(data.get("password") || ""), token);
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
            minLength={10}
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
            Convide outro responsável do parque com acesso individual. O sistema gera um link, mas não envia o email automaticamente.
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
              "park_manager",
            );
            const url = new URL("/entrar", window.location.origin);
            url.searchParams.set("invite", invitation.invitation_token);
            setInviteUrl(url.toString());
            setNotice(
              `Convite criado e válido até ${new Date(invitation.expires_at).toLocaleString()}. O sistema não envia email automaticamente: copie o link abaixo e envie ao mesmo endereço convidado. A pessoa deve confirmar o email, criar a senha ou entrar e abrir o link neste navegador.`,
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
        <p className="subtle">Este formulário convida apenas outro responsável do parque. A equipe de escritório, locução, julgamento e pista precisa de convites vinculados a um evento.</p>
        <button className="primary" disabled={busy}>
          {busy ? "Criando…" : "Criar convite de responsável"}
        </button>
      </form>
      {inviteUrl && <label className="field"><span>Link para copiar e enviar manualmente</span><textarea readOnly value={inviteUrl} aria-label="Link de convite" /></label>}
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
