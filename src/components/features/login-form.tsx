"use client";

import { useState, type FormEvent } from "react";
import { ExternalLink, Eye, EyeOff, LogIn } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { Input } from "@/components/ui/form";
import { useI18n } from "@/i18n/provider";
import { apiRequest, errorText } from "./api-client";

export function LoginForm() {
  const { dict } = useI18n();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [needsTwoFactor, setNeedsTwoFactor] = useState(false);
  const [errors, setErrors] = useState<{ identifier?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sessionBlocked, setSessionBlocked] = useState(false);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // The address offered when the browser refuses to keep the session inside an
  // iframe. It is only ever rendered after a client-side event (the blocked flag
  // can never be true during SSR), so reading window here cannot desynchronise
  // hydration — and the notice offers a real address, not a dead control.
  const previewUrl = sessionBlocked && typeof window !== "undefined" ? `${window.location.origin}/dashboard` : "/dashboard";

  const validate = () => {
    const next: typeof errors = {};
    if (identifier.trim().length < 3) next.identifier = dict.validation.required;
    if (password.length === 0) next.password = dict.validation.required;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setLoading(true);
    const result = await apiRequest<{ redirectTo: string; handoffUrl: string | null }>("/api/auth/login", "POST", {
      identifier: identifier.trim(),
      password,
      twoFactorCode: twoFactorCode.trim() || undefined,
    });
    if (result.ok) {
      // A 200 only means the credentials were accepted. Verify that the session is
      // actually usable before leaving the form: inside a third-party iframe the
      // browser may refuse the session cookie, and navigating anyway would bounce
      // straight back here with no explanation.
      const session = await apiRequest<{ authenticated: boolean }>("/api/auth/session-state", "GET");
      if (session.ok && session.data.authenticated) {
        // Full page load (not a soft client navigation): the server renders the
        // destination with the session cookie already in place.
        window.location.assign(result.data.redirectTo);
        return;
      }
      setLoading(false);
      setSessionBlocked(true);
      // The preview issues a single-use hand-off link: opening it in a real tab stores
      // the session cookie first-party and lands on the dashboard.
      setHandoffUrl(result.data.handoffUrl ?? null);
      return;
    }
    setLoading(false);
    if (result.code === "TWO_FACTOR_REQUIRED") setNeedsTwoFactor(true);
    setPassword("");
    setFormError(
      errorText(result, {
        invalidCredentials:
          result.code === "INVALID_TWO_FACTOR" || result.code === "TWO_FACTOR_REQUIRED"
            ? dict.auth.twoFactorInvalid
            : dict.auth.invalidCredentials,
        tooManyAttempts: dict.auth.tooManyAttempts,
        accountDisabled: dict.auth.accountDisabled,
        network: dict.common.networkError,
        unknown: result.code === "HTTP_500" || result.code === "INTERNAL" ? dict.auth.serverError : dict.common.unknownError,
      }),
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" aria-describedby={formError ? "login-error" : undefined}>
      {formError ? (
        <div id="login-error">
          <Alert tone="danger">{formError}</Alert>
        </div>
      ) : null}
      {sessionBlocked ? (
        <Alert tone="warning">
          <p className="font-semibold">{dict.auth.sessionNotStored}</p>
          <p className="mt-2 text-sm">{dict.auth.copyAddress}</p>
          <p className="mt-1 break-all text-sm" dir="ltr">
            {previewUrl}
          </p>
          <a
            href={handoffUrl ?? previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2"
          >
            <ExternalLink className="size-4" aria-hidden />
            {dict.auth.openInNewTab}
          </a>
        </Alert>
      ) : null}
      <Input
        label={dict.auth.identifier}
        name="identifier"
        autoComplete="username"
        inputMode="email"
        dir="ltr"
        className="text-start"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        error={errors.identifier}
        hint={dict.auth.loginSubtitle}
        autoFocus
      />
      <div className="grid gap-1.5">
        <div className="relative">
          <Input
            label={dict.auth.password}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            dir="ltr"
            className="pe-12 text-start"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? dict.auth.hidePassword : dict.auth.showPassword}
            aria-pressed={showPassword}
            className="absolute end-1.5 top-[2.35rem] grid size-9 place-items-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
          >
            {showPassword ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
          </button>
        </div>
      </div>
      {needsTwoFactor ? (
        <Input
          label={dict.auth.twoFactorCode}
          name="twoFactorCode"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          dir="ltr"
          className="text-start tracking-[0.4em]"
          value={twoFactorCode}
          onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          hint={dict.auth.twoFactorHint}
        />
      ) : null}
      <Button type="submit" size="lg" loading={loading} className="mt-1 w-full">
        {loading ? dict.auth.submitting : (
          <>
            <LogIn className="size-5" aria-hidden />
            {dict.auth.submit}
          </>
        )}
      </Button>
    </form>
  );
}
