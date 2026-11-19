import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useAuth } from "../providers/AuthProvider";
import { Button, IconButton } from "../../../shared/ui/button";
import { Input, FormField } from "../../../shared/ui/form";
import { InlineAlert } from "../../../shared/ui/feedback";
import { BrandMark } from "../../../shared/ui/identity";

export function LoginForm() {
  const { t } = useTranslation(["auth", "app"]);
  const { login, reason } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!email.trim() || !password) {
      setError("auth:required");
      return;
    }
    setPending(true);
    setError("");
    try {
      const message = await login(email, password);
      if (message) setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="sd-login-form">
      <div className="sd-card-brand"><BrandMark size={30} /><strong>VDaAgent</strong></div>
      <div className="sd-login-heading">
        <span className="sd-kicker"><LockKeyhole size={12} /> {t("desktop_secure")}</span>
        <h2>{t("welcome")}</h2>
        <p>{t("desktop_loginNote")}</p>
      </div>
      {reason && <InlineAlert>{t(reason)}</InlineAlert>}
      <form onSubmit={submit} className="stack" noValidate>
        <FormField id="email" label={t("email")}>
          <Input id="email" type="text" autoCapitalize="none" spellCheck={false}
            autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} required />
        </FormField>
        <FormField id="password" label={t("password")}>
          <div className="sd-password-wrap">
            <Input id="password" type={visible ? "text" : "password"} autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined} required />
            <IconButton label={t(visible ? "hide" : "show")} aria-pressed={visible}
              onClick={() => setVisible(!visible)}>
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </IconButton>
          </div>
        </FormField>
        {error && <p role="alert" id="login-error" className="error">{t(error)}</p>}
        <Button type="submit" variant="primary" pending={pending}>
          {pending ? t("app:loading") : t("submit")}<ArrowRight size={18} />
        </Button>
      </form>
    </div>
  );
}
