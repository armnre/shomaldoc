/**
 * M14 — personal data masking.
 *
 * Personal identifiers (national id, student number, phone, email) are masked before
 * they leave the server for anyone who is not the owner of the record or an operator
 * holding the explicit `users.view` permission. Masking keeps enough digits for a
 * human to recognise their own record while never exposing the full identifier in a
 * list, a report or a printed PDF.
 */

export function maskNationalId(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.trim();
  if (digits.length < 4) return "—";
  return `${digits.slice(0, 3)}****${digits.slice(-2)}`;
}

export function maskStudentNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (text.length <= 4) return "—";
  return `${text.slice(0, 2)}***${text.slice(-2)}`;
}

export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const [name, domain] = value.trim().split("@");
  if (!domain) return "—";
  const head = name.slice(0, 1);
  return `${head}${"*".repeat(Math.max(3, name.length - 1))}@${domain}`;
}

export function maskPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "—";
  return `${digits.slice(0, 4)}***${digits.slice(-2)}`;
}

/** True when the viewer may see raw identifiers (owner or operator). */
export function maySeePersonalData(input: { isOwner: boolean; permissions: string[] }): boolean {
  return input.isOwner || input.permissions.includes("users.view");
}
