/**
 * Source of the permission and role catalog. Seeding is idempotent: new permissions are
 * inserted, and default grants are applied only when a role is created for the first time,
 * so manual changes made by administrators are never overwritten on redeploy.
 */

export const PERMISSIONS = [
  // System
  { key: "dashboard.view", groupKey: "dashboard", description: "مشاهده داشبورد" },
  { key: "users.view", groupKey: "users", description: "مشاهده فهرست کاربران" },
  { key: "users.manage", groupKey: "users", description: "ایجاد/ویرایش کاربران و تخصیص نقش" },
  { key: "roles.view", groupKey: "roles", description: "مشاهده نقش‌ها و دسترسی‌ها" },
  { key: "roles.manage", groupKey: "roles", description: "تغییر دسترسی نقش‌ها" },
  { key: "audit.view", groupKey: "audit", description: "مشاهده گزارش ممیزی" },
  { key: "settings.view", groupKey: "settings", description: "مشاهده تنظیمات" },
  { key: "settings.manage", groupKey: "settings", description: "تغییر تنظیمات" },
  { key: "system.design", groupKey: "system", description: "مشاهده صفحه سیستم طراحی" },
  { key: "org.view", groupKey: "org", description: "مشاهده ساختار سازمانی (دانشکده و گروه)" },
  { key: "org.manage", groupKey: "org", description: "مدیریت ساختار سازمانی (دانشکده و گروه)" },
  { key: "workflow.view", groupKey: "workflow", description: "مشاهده تعریف‌های گردش‌کار" },
  { key: "workflow.manage", groupKey: "workflow", description: "ویرایش و انتشار نسخهٔ گردش‌کار" },
  // Cases
  { key: "cases.edit_metadata", groupKey: "cases", description: "ویرایش اطلاعات اصلی و هویتی پرونده" },
  { key: "cases.view_own", groupKey: "cases", description: "مشاهده پرونده خود" },
  { key: "cases.view_assigned", groupKey: "cases", description: "مشاهده پرونده‌های ارجاع‌شده" },
  { key: "cases.view_department", groupKey: "cases", description: "مشاهده پرونده‌های گروه" },
  { key: "cases.view_all", groupKey: "cases", description: "مشاهده همه پرونده‌ها" },
  { key: "cases.create", groupKey: "cases", description: "ایجاد پرونده" },
  { key: "cases.update_own_draft", groupKey: "cases", description: "ویرایش پیش‌نویس خود" },
  { key: "cases.update_assigned", groupKey: "cases", description: "ویرایش پرونده ارجاع‌شده" },
  { key: "cases.assign_supervisors", groupKey: "cases", description: "انتساب استادان" },
  { key: "cases.submit_topic", groupKey: "cases", description: "ثبت موضوع پایان‌نامه" },
  { key: "cases.review_topic", groupKey: "cases", description: "بررسی موضوع" },
  { key: "cases.transition_status", groupKey: "cases", description: "تغییر وضعیت پرونده" },
  { key: "cases.archive", groupKey: "cases", description: "بایگانی پرونده" },
  { key: "cases.events.view", groupKey: "cases", description: "مشاهده تاریخچه پرونده" },
  { key: "cases.files.upload", groupKey: "cases", description: "بارگذاری فایل" },
  { key: "cases.files.download", groupKey: "cases", description: "دانلود فایل" },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

export const ROLES = [
  {
    key: "student",
    nameFa: "دانشجو",
    description: "دانشجوی تحصیلات تکمیلی",
    defaultPermissions: ["dashboard.view", "cases.view_own", "cases.create", "cases.update_own_draft", "cases.submit_topic", "cases.events.view", "cases.files.upload", "cases.files.download"],
  },
  {
    key: "supervisor",
    nameFa: "استاد راهنما",
    description: "استاد راهنمای پایان‌نامه",
    defaultPermissions: ["dashboard.view", "cases.view_assigned", "cases.update_assigned", "cases.review_topic", "cases.assign_supervisors", "cases.transition_status", "cases.events.view", "cases.files.download"],
  },
  {
    key: "advisor",
    nameFa: "استاد مشاور",
    description: "استاد مشاور پایان‌نامه",
    defaultPermissions: ["dashboard.view", "cases.view_assigned", "cases.events.view", "cases.files.download"],
  },
  {
    key: "dept_head",
    nameFa: "مدیر گروه",
    description: "مدیر گروه آموزشی",
    defaultPermissions: ["dashboard.view", "cases.view_department", "cases.create", "cases.edit_metadata", "cases.update_assigned", "cases.review_topic", "cases.assign_supervisors", "cases.transition_status", "cases.events.view", "cases.files.download", "org.view"],
  },
  {
    key: "grad_office",
    nameFa: "تحصیلات تکمیلی",
    description: "کارشناس تحصیلات تکمیلی",
    defaultPermissions: ["dashboard.view", "cases.view_all", "cases.create", "cases.edit_metadata", "cases.update_assigned", "cases.review_topic", "cases.assign_supervisors", "cases.transition_status", "cases.archive", "cases.events.view", "cases.files.download", "org.view"],
  },
  {
    key: "finance",
    nameFa: "امور مالی",
    description: "کارشناس امور مالی",
    defaultPermissions: ["dashboard.view", "cases.view_all"],
  },
  {
    key: "reviewer",
    nameFa: "داور",
    description: "داور پایان‌نامه",
    defaultPermissions: ["dashboard.view", "cases.view_assigned", "cases.events.view", "cases.files.download"],
  },
  {
    key: "graduation_officer",
    nameFa: "مسئول فارغ‌التحصیلی",
    description: "مسئول بررسی فارغ‌التحصیلی",
    defaultPermissions: ["dashboard.view", "cases.view_all", "cases.transition_status", "cases.archive", "cases.events.view"],
  },
  {
    key: "system_admin",
    nameFa: "مدیر سیستم",
    description: "دسترسی کامل به مدیریت سامانه",
    defaultPermissions: ALL_PERMISSION_KEYS,
  },
] as const satisfies ReadonlyArray<{
  key: string;
  nameFa: string;
  description: string;
  defaultPermissions: readonly string[];
}>;

export type RoleKey = (typeof ROLES)[number]["key"];

/**
 * Grants that can never be revoked from a role. They prevent the system from being
 * locked out of its own administration.
 */
export const PROTECTED_GRANTS: Partial<Record<RoleKey, readonly PermissionKey[]>> = {
  system_admin: ["roles.manage", "users.manage"],
};

export function isProtectedGrant(roleKey: string, permissionKey: string): boolean {
  const protectedKeys = PROTECTED_GRANTS[roleKey as RoleKey] ?? [];
  return (protectedKeys as readonly string[]).includes(permissionKey);
}
