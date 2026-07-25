// §10.2 guest→account migration, offered at the end of every match: the
// moment a guest has something worth keeping (Jade just settled, a hand just
// won) is the moment to ask them to secure it. The upgrade keeps the same
// AGS account — see BrowserIam.upgradeGuestAccount — so nothing the player
// earned moves or resets, and the copy here says so.
//
// The flow mirrors the sign-in screen's registration wizard: request a
// verification code for the email, then submit that code with the account
// details, so the account is email-verified the moment it exists.
import { useState } from "react";

import { CLOSED_BETA_COUNTRIES, DEFAULT_COUNTRY_CODE } from "./countries";
import { IamAuthError, type GuestUpgradeInput } from "./iam";
import { MINIMUM_ACCOUNT_AGE, ageInYears } from "./age-gate";

export interface AccountUpgradeCardProps {
  onRequestCode(email: string): Promise<void>;
  onUpgrade(input: GuestUpgradeInput): Promise<void>;
  // Fired once the AGS upgrade succeeds, so the surrounding screen can stop
  // treating this player as a guest.
  onUpgraded?(): void;
}

type Step = "cta" | "email" | "details" | "done";

type Status =
  | { status: "idle" }
  | { status: "working" }
  | { status: "error"; message: string };

function upgradeErrorMessage(error: unknown): string {
  if (error instanceof IamAuthError) {
    return error.message;
  }
  return "Something went wrong. Please retry.";
}

export function AccountUpgradeCard({ onRequestCode, onUpgrade, onUpgraded }: AccountUpgradeCardProps) {
  const [step, setStep] = useState<Step>("cta");
  const [status, setStatus] = useState<Status>({ status: "idle" });
  const [form, setForm] = useState({
    email: "",
    code: "",
    username: "",
    password: "",
    country: DEFAULT_COUNTRY_CODE,
    birthYear: "",
    birthMonth: "",
    ageConfirmed: false,
  });

  const working = status.status === "working";
  const birthYearOptions = Array.from({ length: 100 }, (_, index) => new Date().getFullYear() - index);

  function update(patch: Partial<typeof form>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  async function requestCode() {
    setStatus({ status: "working" });
    try {
      await onRequestCode(form.email.trim());
      setStep("details");
      setStatus({ status: "idle" });
    } catch (error) {
      setStatus({ status: "error", message: upgradeErrorMessage(error) });
    }
  }

  async function submitUpgrade() {
    const birthYear = Number(form.birthYear);
    const birthMonth = Number(form.birthMonth);

    if (!form.ageConfirmed) {
      setStatus({ status: "error", message: "Confirm your age to continue." });
      return;
    }
    if (!Number.isInteger(birthYear) || !Number.isInteger(birthMonth)) {
      setStatus({ status: "error", message: "Enter your birth month and year." });
      return;
    }
    if (ageInYears(birthYear, birthMonth) < MINIMUM_ACCOUNT_AGE) {
      setStatus({
        status: "error",
        message: `You must be at least ${MINIMUM_ACCOUNT_AGE} years old to create an account.`,
      });
      return;
    }

    setStatus({ status: "working" });
    try {
      await onUpgrade({
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        country: form.country,
        birthYear,
        birthMonth,
        code: form.code.trim(),
      });
      setStep("done");
      setStatus({ status: "idle" });
      onUpgraded?.();
    } catch (error) {
      setStatus({ status: "error", message: upgradeErrorMessage(error) });
    }
  }

  if (step === "done") {
    return (
      <section className="account-upgrade-card" aria-label="Account created" role="status">
        <p className="status-label">Account created</p>
        <p className="account-upgrade-intro">
          You can now sign in with {form.email.trim()} on any device. Your Jade, rating, and
          progression stayed with this account.
        </p>
      </section>
    );
  }

  return (
    <section className="account-upgrade-card" aria-labelledby="account-upgrade-title">
      <p className="status-label">Playing as a guest</p>
      <h3 id="account-upgrade-title">Keep this progress</h3>
      <p className="account-upgrade-intro">
        Add an email and password to this account. Your Jade, rating, and progression stay exactly
        as they are — a full account just means you can sign back in from another device, or after
        clearing this browser's storage.
      </p>

      {step === "cta" && (
        <button
          type="button"
          className="secondary-action account-upgrade-open"
          onClick={() => {
            setStep("email");
            setStatus({ status: "idle" });
          }}
        >
          Create a full account
        </button>
      )}

      {step !== "cta" && (
        <form
          className="email-auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === "email") {
              void requestCode();
            } else {
              void submitUpgrade();
            }
          }}
        >
          <label className="session-input-label" htmlFor="upgrade-email">
            Email
          </label>
          <input
            id="upgrade-email"
            className="session-input"
            type="email"
            autoComplete="email"
            required
            disabled={step === "details"}
            value={form.email}
            onChange={(event) => update({ email: event.target.value })}
          />

          {step === "email" ? (
            <button
              type="submit"
              className="secondary-action session-action"
              disabled={working || !form.email}
            >
              {working ? "Sending code…" : "Send verification code"}
            </button>
          ) : (
            <>
              <label className="session-input-label" htmlFor="upgrade-code">
                Verification code
              </label>
              <input
                id="upgrade-code"
                className="session-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={form.code}
                onChange={(event) => update({ code: event.target.value })}
              />

              <label className="session-input-label" htmlFor="upgrade-username">
                Username
              </label>
              <input
                id="upgrade-username"
                className="session-input"
                type="text"
                autoComplete="username"
                required
                value={form.username}
                onChange={(event) => update({ username: event.target.value })}
              />

              <label className="session-input-label" htmlFor="upgrade-password">
                Password
              </label>
              <input
                id="upgrade-password"
                className="session-input"
                type="password"
                autoComplete="new-password"
                required
                value={form.password}
                onChange={(event) => update({ password: event.target.value })}
              />

              <label className="session-input-label" htmlFor="upgrade-country">
                Country
              </label>
              <select
                id="upgrade-country"
                className="session-input"
                value={form.country}
                onChange={(event) => update({ country: event.target.value })}
              >
                {CLOSED_BETA_COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>

              <span className="session-input-label">Birth month and year</span>
              <div className="email-auth-row">
                <select
                  aria-label="Birth month"
                  className="session-input"
                  required
                  value={form.birthMonth}
                  onChange={(event) => update({ birthMonth: event.target.value })}
                >
                  <option value="" disabled>
                    Month
                  </option>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Birth year"
                  className="session-input"
                  required
                  value={form.birthYear}
                  onChange={(event) => update({ birthYear: event.target.value })}
                >
                  <option value="" disabled>
                    Year
                  </option>
                  {birthYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>

              <label className="email-auth-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.ageConfirmed}
                  onChange={(event) => update({ ageConfirmed: event.target.checked })}
                />
                I confirm this birth month and year are accurate.
              </label>

              <button type="submit" className="primary-action session-action" disabled={working}>
                {working ? "Creating account…" : "Create account"}
              </button>
            </>
          )}

          <button
            type="button"
            className="secondary-action account-upgrade-dismiss"
            disabled={working}
            onClick={() => {
              setStep("cta");
              setStatus({ status: "idle" });
            }}
          >
            Not now
          </button>
        </form>
      )}

      {status.status === "error" && (
        <div className="session-error" role="alert">
          <p>{status.message}</p>
        </div>
      )}
    </section>
  );
}
