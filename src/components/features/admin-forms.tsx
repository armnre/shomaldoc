"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Alert, Button, Badge } from "@/components/ui";
import { Checkbox, Dialog, Input, Switch, Textarea } from "@/components/ui/form";
import { useI18n } from "@/i18n/provider";
import { formatDateTime } from "@/lib/format";
import { apiRequest, errorText } from "./api-client";
import type { SettingView } from "@/server/services/settings";

interface RoleOption {
  id: number;
  key: string;
  nameFa: string;
}

function useErrorMessages() {
  const { dict } = useI18n();
  return (result: { code: string; message: string }) =>
    errorText(result, {
      invalidCredentials: dict.auth.invalidCredentials,
      tooManyAttempts: dict.auth.tooManyAttempts,
      accountDisabled: dict.auth.accountDisabled,
      network: dict.common.networkError,
      unknown: dict.common.unknownError,
    });
}

/* ------------------------------------------------------------------ */
/* Create user                                                          */
/* ------------------------------------------------------------------ */

export function UserCreateDialog({ roles }: { roles: RoleOption[] }) {
  const { dict } = useI18n();
  const router = useRouter();
  const toMessage = useErrorMessages();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState({ username: "", email: "", fullName: "", initialPassword: "", mustChangePassword: true });
  const [roleIds, setRoleIds] = useState<number[]>([]);

  const reset = () => {
    setForm({ username: "", email: "", fullName: "", initialPassword: "", mustChangePassword: true });
    setRoleIds([]);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await apiRequest("/api/admin/users", "POST", { ...form, roleIds });
    setBusy(false);
    if (!result.ok) {
      setError(toMessage(result));
      return;
    }
    setSuccess(dict.users.created);
    setOpen(false);
    reset();
    router.refresh();
  };

  return (
    <>
      <Button onClick={() => { setSuccess(null); setOpen(true); }}>{dict.users.create}</Button>
      {success ? <div className="mt-4"><Alert tone="success">{success}</Alert></div> : null}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={dict.users.createTitle}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>{dict.common.cancel}</Button>
            <Button type="submit" form="create-user-form" loading={busy}>{dict.common.create}</Button>
          </>
        }
      >
        <form id="create-user-form" onSubmit={submit} className="grid gap-4">
          <p className="text-sm text-fg-muted">{dict.users.createText}</p>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Input label={dict.users.fullName} required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={dict.users.username} required dir="ltr" className="text-start" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <Input label={dict.users.email} required type="email" dir="ltr" className="text-start" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <Input label={dict.users.initialPassword} required type="text" dir="ltr" className="text-start font-mono" hint={dict.auth.passwordRules} value={form.initialPassword} onChange={(e) => setForm({ ...form, initialPassword: e.target.value })} />
          <Checkbox label={dict.users.mustChange} checked={form.mustChangePassword} onChange={(e) => setForm({ ...form, mustChangePassword: e.target.checked })} />
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{dict.users.rolesTitle}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {roles.map((role) => (
                <Checkbox
                  key={role.id}
                  label={dict.roleNames[role.key] ?? role.nameFa}
                  checked={roleIds.includes(role.id)}
                  onChange={(e) => setRoleIds(e.target.checked ? [...roleIds, role.id] : roleIds.filter((id) => id !== role.id))}
                />
              ))}
            </div>
          </fieldset>
        </form>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Edit user (status + roles, reason required)                          */
/* ------------------------------------------------------------------ */

export function UserEditForm({
  userId,
  isActive: initialActive,
  isSelf,
  allRoles,
  currentRoleIds,
  canManage,
  department: initialDepartment,
}: {
  userId: string;
  isActive: boolean;
  isSelf: boolean;
  allRoles: RoleOption[];
  currentRoleIds: number[];
  canManage: boolean;
  department?: string | null;
}) {
  const { dict } = useI18n();
  const router = useRouter();
  const toMessage = useErrorMessages();
  const [isActive, setIsActive] = useState(initialActive);
  const [department, setDepartment] = useState(initialDepartment ?? "");
  const [roleIds, setRoleIds] = useState<number[]>(currentRoleIds);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const changed =
    isActive !== initialActive ||
    department.trim() !== (initialDepartment ?? "") ||
    [...roleIds].sort().join() !== [...currentRoleIds].sort().join();

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const body: Record<string, unknown> = { reason: reason.trim() };
    if (isActive !== initialActive) body.isActive = isActive;
    if (department.trim() !== (initialDepartment ?? "")) body.department = department.trim() || null;
    if ([...roleIds].sort().join() !== [...currentRoleIds].sort().join()) body.roleIds = roleIds;
    const result = await apiRequest(`/api/admin/users/${userId}`, "PATCH", body);
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: toMessage(result) });
      return;
    }
    setMessage({ tone: "success", text: dict.users.updated });
    setReason("");
    router.refresh();
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-surface-2 p-4">
        <div>
          <p className="font-semibold">{dict.common.status}</p>
          <p className="text-sm text-fg-muted">{isActive ? dict.common.active : dict.common.inactive}</p>
        </div>
        <Switch
          checked={isActive}
          onChange={setIsActive}
          label={dict.common.status}
          disabled={!canManage || isSelf}
        />
      </div>
      {isSelf ? <p className="text-xs text-fg-muted">{dict.common.reason}: —</p> : null}

      <Input
        label={dict.cases.form.department}
        value={department}
        onChange={(e) => setDepartment(e.target.value)}
        disabled={!canManage}
        hint={dict.common.optional}
      />

      <fieldset className="grid gap-3">
        <legend className="mb-1 font-semibold">{dict.users.rolesTitle}</legend>
        <p className="text-sm text-fg-muted">{dict.users.rolesText}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {allRoles.map((role) => (
            <Checkbox
              key={role.id}
              disabled={!canManage}
              label={dict.roleNames[role.key] ?? role.nameFa}
              checked={roleIds.includes(role.id)}
              onChange={(e) => setRoleIds(e.target.checked ? [...roleIds, role.id] : roleIds.filter((id) => id !== role.id))}
            />
          ))}
        </div>
      </fieldset>

      {canManage ? (
        <div className="grid gap-4">
          <Textarea label={`${dict.common.reason} (${dict.common.required})`} placeholder={dict.users.reasonPlaceholder} value={reason} onChange={(e) => setReason(e.target.value)} />
          {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
          <div className="flex justify-end">
            <Button onClick={save} loading={busy} disabled={!changed || reason.trim().length < 3}>
              {dict.common.save}
            </Button>
          </div>
        </div>
      ) : (
        <Alert tone="info">{dict.errors.forbiddenText}</Alert>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roles × permissions matrix (one cell = one role/permission pair)     */
/* ------------------------------------------------------------------ */

export function RolesMatrix({
  roles,
  permissions,
  granted,
  protectedKeys,
  canManage,
}: {
  roles: Array<{ id: number; key: string; nameFa: string }>;
  permissions: Array<{ id: number; key: string; groupKey: string; description: string }>;
  granted: string[];
  protectedKeys: Record<string, string[]>;
  canManage: boolean;
}) {
  const { dict, locale } = useI18n();
  const toMessage = useErrorMessages();
  const [grants, setGrants] = useState(() => new Set(granted));
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof permissions>();
    for (const p of permissions) {
      const list = map.get(p.groupKey) ?? [];
      list.push(p);
      map.set(p.groupKey, list);
    }
    return [...map.entries()];
  }, [permissions]);

  const toggle = async (roleId: number, roleKey: string, permissionKey: string, permissionId: number, next: boolean) => {
    const cell = `${roleId}:${permissionId}`;
    setPending(cell);
    setMessage(null);
    const result = await apiRequest<{ changed: boolean }>(`/api/admin/roles/${roleId}/permissions`, "PUT", {
      permissionKey,
      granted: next,
      reason: reason.trim(),
    });
    setPending(null);
    if (!result.ok) {
      setMessage({ tone: "danger", text: toMessage(result) });
      return;
    }
    setGrants((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(cell);
      else copy.delete(cell);
      return copy;
    });
    setMessage({ tone: "success", text: dict.roles.saved });
    void roleKey;
  };

  const reasonOk = reason.trim().length >= 3;

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 rounded-xl border border-border bg-surface p-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <Textarea
          label={dict.roles.reasonLabel}
          placeholder={dict.users.reasonPlaceholder}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-16"
          disabled={!canManage}
        />
        <p className="text-xs text-fg-muted sm:max-w-xs">{dict.roles.subtitle}</p>
      </div>
      {!canManage ? <Alert tone="info">{dict.errors.forbiddenText}</Alert> : null}
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-soft">
        <table className="w-full min-w-[46rem] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-start">
              <th scope="col" className="sticky start-0 z-10 bg-surface-2 p-3 text-start font-semibold">{dict.roles.permission}</th>
              {roles.map((role) => (
                <th key={role.id} scope="col" className="p-3 text-center font-semibold">
                  <span className="block">{dict.roleNames[role.key] ?? role.nameFa}</span>
                  <span className="block text-[0.7rem] font-normal text-fg-muted" dir="ltr">{role.key}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grouped.map(([groupKey, perms]) => (
              <GroupRows key={groupKey} title={(dict.roles.groups as Record<string, string>)[groupKey] ?? groupKey} colSpan={roles.length + 1}>
                {perms.map((perm) => (
                  <tr key={perm.id} className="border-t border-border hover:bg-surface-2/60">
                    <th scope="row" className="sticky start-0 z-[1] bg-surface p-3 text-start font-normal">
                      <span className="block font-medium text-fg" dir="ltr">{perm.key}</span>
                      <span className="block text-xs text-fg-muted">{perm.description}</span>
                    </th>
                    {roles.map((role) => {
                      const cell = `${role.id}:${perm.id}`;
                      const locked = (protectedKeys[role.key] ?? []).includes(perm.key);
                      const checked = grants.has(cell);
                      const disabled = !canManage || !reasonOk || locked || pending === cell;
                      return (
                        <td key={cell} className="p-3 text-center">
                          <label className="inline-flex items-center justify-center">
                            <input
                              type="checkbox"
                              className="size-5 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                              checked={checked}
                              disabled={disabled}
                              aria-label={`${dict.roleNames[role.key] ?? role.nameFa} — ${perm.key}`}
                              title={locked ? dict.roles.lockedHint : undefined}
                              onChange={(e) => toggle(role.id, role.key, perm.key, perm.id, e.target.checked)}
                            />
                            <span className="sr-only">{checked ? dict.roles.granted : ""}</span>
                          </label>
                          {locked ? <span className="mt-1 block text-[0.65rem] text-warning">{dict.roles.locked}</span> : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </GroupRows>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-muted">{locale === "fa" ? dict.roles.lockedHint : dict.roles.lockedHint}</p>
    </div>
  );
}

function GroupRows({ title, colSpan, children }: { title: string; colSpan: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-primary-soft/60">
        <th colSpan={colSpan} scope="colgroup" className="px-3 py-2 text-start text-xs font-semibold text-primary">{title}</th>
      </tr>
      {children}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export function SettingsForm({ settings, canManage }: { settings: SettingView[]; canManage: boolean }) {
  const { dict, locale } = useI18n();
  const router = useRouter();
  const toMessage = useErrorMessages();
  const [reason, setReason] = useState("");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(settings.map((s) => [s.key, String(s.value)])),
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [history, setHistory] = useState<Record<string, Array<{ version: number; value: unknown; changedAt: string; reason: string | null }>>>({});

  const save = async (setting: SettingView) => {
    setBusyKey(setting.key);
    setMessage(null);
    const raw = values[setting.key];
    const value = setting.type === "number" ? Number(raw) : setting.type === "boolean" ? raw === "true" : raw;
    const result = await apiRequest<{ version: number }>("/api/admin/settings", "PUT", { key: setting.key, value, reason: reason.trim() });
    setBusyKey(null);
    if (!result.ok) {
      setMessage({ tone: "danger", text: toMessage(result) });
      return;
    }
    setMessage({ tone: "success", text: dict.settings.saved });
    router.refresh();
  };

  const loadHistory = async (key: string) => {
    const result = await apiRequest<{ versions: Array<{ version: number; value: unknown; changedAt: string; reason: string | null }> }>(
      `/api/admin/settings?history=${encodeURIComponent(key)}`,
      "GET",
    );
    if (result.ok) setHistory((prev) => ({ ...prev, [key]: result.data.versions }));
  };

  return (
    <div className="grid gap-6">
      <div className="rounded-xl border border-border bg-surface p-5">
        <Textarea label={dict.common.reason} placeholder={dict.settings.reasonPlaceholder} value={reason} onChange={(e) => setReason(e.target.value)} disabled={!canManage} className="min-h-16" />
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <div className="grid gap-4">
        {settings.map((setting) => {
          const dirty = values[setting.key] !== String(setting.value);
          return (
            <div key={setting.key} className="rounded-xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-fg">{setting.label}</p>
                  <p className="text-xs text-fg-muted" dir="ltr">{setting.key} · {dict.settings.version} {setting.version.toLocaleString(locale === "fa" ? "fa-IR" : "en-US")}</p>
                </div>
                <Badge tone="primary">{dict.settings.colVersion}: {setting.version}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                {setting.type === "boolean" ? (
                  <div className="flex min-w-56 flex-1 items-end gap-3 pb-1">
                    <Switch
                      checked={values[setting.key] === "true"}
                      disabled={!canManage}
                      label={setting.label}
                      onChange={(v) => setValues({ ...values, [setting.key]: String(v) })}
                    />
                    <span className="text-sm text-fg-muted">{values[setting.key] === "true" ? dict.common.yes : dict.common.no}</span>
                  </div>
                ) : (
                <div className="min-w-56 flex-1">
                  <Input
                    label={dict.settings.colValue}
                    type={setting.type === "number" ? "number" : "text"}
                    min={setting.type === "number" ? setting.min : undefined}
                    max={setting.type === "number" ? setting.max : undefined}
                    hint={setting.type === "number" ? `${setting.min} – ${setting.max}` : undefined}
                    disabled={!canManage}
                    value={values[setting.key] ?? ""}
                    onChange={(e) => setValues({ ...values, [setting.key]: e.target.value })}
                  />
                </div>
                )}
                <Button onClick={() => save(setting)} loading={busyKey === setting.key} disabled={!canManage || !dirty || reason.trim().length < 3}>
                  {dict.common.save}
                </Button>
                <Button variant="ghost" onClick={() => loadHistory(setting.key)}>{dict.settings.history}</Button>
              </div>
              {history[setting.key] ? (
                <div className="mt-4 rounded-lg bg-surface-2 p-3">
                  <p className="mb-2 text-sm font-semibold">{dict.settings.historyTitle}</p>
                  {history[setting.key].length === 0 ? (
                    <p className="text-sm text-fg-muted">{dict.settings.noHistory}</p>
                  ) : (
                    <ul className="grid gap-1.5 text-sm">
                      {history[setting.key].map((v) => (
                        <li key={v.version} className="flex flex-wrap justify-between gap-2">
                          <span className="tabular">{dict.settings.version} {v.version}: <bdi dir="ltr">{String(v.value)}</bdi></span>
                          <span className="text-fg-muted">{formatDateTime(v.changedAt, locale)} — {v.reason ?? "—"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Password change                                                      */
/* ------------------------------------------------------------------ */

export function PasswordForm() {
  const { dict } = useI18n();
  const router = useRouter();
  const toMessage = useErrorMessages();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [mismatch, setMismatch] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    if (form.newPassword !== form.confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setBusy(true);
    const result = await apiRequest<{ otherSessionsRevoked: number }>("/api/auth/password", "POST", {
      currentPassword: form.currentPassword,
      newPassword: form.newPassword,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ tone: "danger", text: toMessage(result) });
      return;
    }
    setForm({ currentPassword: "", newPassword: "", confirm: "" });
    setMessage({ tone: "success", text: `${dict.auth.passwordChanged} ${dict.auth.sessionsRevoked}` });
    router.refresh();
  };

  return (
    <form onSubmit={submit} noValidate className="grid max-w-md gap-5">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <Input label={dict.auth.currentPassword} type="password" autoComplete="current-password" dir="ltr" className="text-start" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
      <Input label={dict.auth.newPassword} type="password" autoComplete="new-password" dir="ltr" className="text-start" required hint={dict.auth.passwordRules} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
      <Input label={dict.auth.confirmPassword} type="password" autoComplete="new-password" dir="ltr" className="text-start" required value={form.confirm} error={mismatch ? dict.auth.passwordMismatch : undefined} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
      <div>
        <Button type="submit" loading={busy}>{dict.common.save}</Button>
      </div>
    </form>
  );
}
