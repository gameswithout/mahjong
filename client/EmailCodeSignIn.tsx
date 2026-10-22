import { useRef, useState } from "react";
import { XsollaEmailError } from "./xsolla-email";
import { IamAuthError } from "./iam";

export function EmailCodeSignIn({ onRequestCode, onConfirm }: {
  onRequestCode: (email: string) => Promise<string>;
  onConfirm: (email: string, code: string, operationId: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [operationId, setOperationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState("");
  async function submit(resend = false) {
    if (working.current) return;
    working.current = true; setBusy(true); setError("");
    try {
      if (!operationId || resend) {
        setOperationId(null); setCode("");
        setOperationId(await onRequestCode(email.trim()));
      } else await onConfirm(email.trim(), code.trim(), operationId);
    } catch (failure) { setError(failure instanceof XsollaEmailError || failure instanceof IamAuthError ? failure.message : "Email sign-in failed. Please try again."); }
    finally { working.current = false; setBusy(false); }
  }
  return <section className="email-auth-panel" aria-labelledby="email-code-title"><h2 id="email-code-title">Continue with email</h2>
    <p>Use a one-time code to sign in or create your account. No password needed.</p>
    <form className="email-auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label htmlFor="email-code-address">Email</label><input className="session-input" id="email-code-address" type="email" autoComplete="email" required disabled={busy || !!operationId} value={email} onChange={(event) => setEmail(event.target.value)} />
      {operationId && <><p role="status">Code requested. Check your email and enter the code below.</p><label htmlFor="email-one-time-code">Verification code</label><input className="session-input" id="email-one-time-code" type="text" inputMode="numeric" autoComplete="one-time-code" required disabled={busy} value={code} onChange={(event) => setCode(event.target.value)} /></>}
      <button className="secondary-action" type="submit" disabled={busy}>{busy ? "Please wait…" : operationId ? "Verify and continue" : "Send email code"}</button>
      {operationId && <><button className="text-action" type="button" disabled={busy} onClick={() => { void submit(true); }}>Request a new code</button><button className="text-action" type="button" disabled={busy} onClick={() => { setOperationId(null); setCode(""); setError(""); }}>Use another email</button></>}
      {error && <p className="session-error" role="alert">{error}</p>}
    </form>
  </section>;
}
