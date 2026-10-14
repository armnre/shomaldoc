import { Card, KeyValue, PageHeader, Badge } from "@/components/ui";
import { PasswordForm } from "@/components/features/admin-forms";
import { SessionsPanel, TwoFactorPanel } from "@/components/features/security-panels";
import { requireUser } from "@/server/auth/current-user";
import { getServerI18n } from "@/i18n/server";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  const { dict } = await getServerI18n();
  return (
    <>
      <PageHeader title={dict.account.title} subtitle={dict.account.subtitle} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="grid content-start gap-5 p-6">
          <h2 className="text-lg font-semibold">{dict.account.profile}</h2>
          <KeyValue
            items={[
              { label: dict.users.fullName, value: user.fullName },
              { label: dict.users.username, value: <span dir="ltr">{user.username}</span> },
              { label: dict.users.email, value: <span dir="ltr">{user.email}</span> },
            ]}
          />
          <div className="flex flex-wrap gap-2">
            {user.roles.length === 0 ? <Badge>{dict.users.noRoles}</Badge> : null}
            {user.roles.map((r) => (
              <Badge key={r.id} tone="primary">{dict.roleNames[r.key] ?? r.nameFa}</Badge>
            ))}
          </div>
          <p className="text-sm text-fg-muted">{dict.account.sessionNote}</p>
        </Card>
        <div className="grid gap-6">
        <Card className="p-6">
          <h2 className="mb-5 text-lg font-semibold">{dict.account.changePassword}</h2>
          {user.mustChangePassword ? <p className="mb-5 rounded-md bg-warning-soft p-3 text-sm text-warning">{dict.auth.mustChangeNotice}</p> : null}
          <PasswordForm />
        </Card>
        <SessionsPanel dict={dict} currentSessionId={user.sessionId} />
        <TwoFactorPanel dict={dict} />
        </div>
      </div>
    </>
  );
}
