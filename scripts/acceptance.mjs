#!/usr/bin/env node
/**
 * End-to-end acceptance run against a REAL running server and the REAL database.
 *
 * It walks the student journey and the staff queues over HTTP exactly as a browser
 * does (session cookie, same-origin requests), checks that every page renders for
 * every role, and proves that a tampered request cannot skip a workflow step.
 * Nothing here is mocked: a failure means the running system is broken.
 *
 * Usage: BASE_URL=http://127.0.0.1:3080 node scripts/acceptance.mjs [--verbose]
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3080";
const VERBOSE = process.argv.includes("--verbose");
// The preview password is never stored in the repository; the operator passes it in:
//   PREVIEW_PASSWORD='<value>' node scripts/acceptance.mjs
const PASSWORD = process.env.PREVIEW_PASSWORD ?? "";
const ACCOUNTS = [
  { key: "admin", identifier: "dev.admin" },
  { key: "depthead", identifier: "dev.depthead" },
  { key: "supervisor", identifier: "dev.supervisor" },
  { key: "student", identifier: "dev.student" },
];

let failures = 0;
let checks = 0;
const log = (...args) => console.log(...args);
const ok = (name, detail = "") => {
  checks += 1;
  log(`ok   ${name}${detail ? ` — ${detail}` : ""}`);
};
const bad = (name, detail = "") => {
  checks += 1;
  failures += 1;
  log(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
};
const expect = (name, actual, wanted) => (actual === wanted ? ok(name, `${actual}`) : bad(name, `expected ${wanted}, got ${actual}`));

async function request(path, { cookie, method = "GET", body, origin = BASE, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(origin ? { origin } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const text = await res.text();
  let json = null;
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, headers: res.headers, text, json, setCookie };
}

async function login(identifier) {
  const res = await request("/api/auth/login", { method: "POST", body: { identifier, password: PASSWORD } });
  if (res.status !== 200) throw new Error(`login failed for ${identifier}: ${res.status} ${res.text.slice(0, 160)}`);
  const cookie = (res.setCookie.find((c) => c.startsWith("shomaldoc_session=")) ?? "").split(";")[0];
  if (!cookie) throw new Error(`no session cookie for ${identifier}`);
  return cookie;
}

// Pages every authenticated account must be able to open (they only need a session
// plus one of the case-view scopes).
const CORE_PAGES = ["/dashboard", "/cases", "/cases/new", "/search", "/reports", "/account"];
// Extra pages a role may or may not hold the permission for; a redirect to
// /forbidden is a correct answer there, an error is not.
const OPTIONAL_PAGES = ["/review", "/supervisors"];
const ADMIN_PAGES = [
  ...CORE_PAGES,
  ...OPTIONAL_PAGES,
  "/admin/users",
  "/admin/roles",
  "/admin/audit",
  "/admin/settings",
  "/admin/forms",
  "/admin/workflows",
  "/admin/organization",
];

async function main() {
  if (PASSWORD.length < 12) {
    throw new Error("set PREVIEW_PASSWORD (the preview demo password) before running this script; it is deliberately not stored in Git");
  }
  log(`acceptance run against ${BASE}\n`);

  log("== 0. public surface");
  const health = await request("/api/health");
  expect("health status", health.status, 200);
  expect("health db", health.json?.db, "up");
  expect("app identity", health.json?.app, "shomaldoc");
  expect("login page", (await request("/login")).status, 200);
  expect("anonymous dashboard redirects", (await request("/dashboard")).status, 307);
  expect("anonymous api rejected", (await request("/api/cases")).status, 401);
  expect("robots disallows crawlers", (await request("/robots.txt")).text.includes("Disallow: /"), true);

  const headers = (await request("/login")).headers;
  const csp = headers.get("content-security-policy") ?? "";
  expect("csp has nonce", /'nonce-[A-Za-z0-9+/=]+'/.test(csp), true);
  expect("csp blocks objects", csp.includes("object-src 'none'"), true);
  expect("HSTS present", (headers.get("strict-transport-security") ?? "").includes("max-age"), true);
  expect("X-Robots-Tag noindex", (headers.get("x-robots-tag") ?? "").includes("noindex"), true);
  expect("X-Content-Type-Options", headers.get("x-content-type-options"), "nosniff");

  const anonSession = await request("/api/auth/session-state");
  expect("session probe reports anonymous", anonSession.json?.data?.authenticated, false);

  log("\n== 1. pages render for every role (real sessions)");
  const sessions = {};
  for (const account of ACCOUNTS) {
    const cookie = await login(account.identifier);
    sessions[account.key] = cookie;
    ok(`login ${account.identifier}`);
    const probe = await request("/api/auth/session-state", { cookie });
    expect(`session probe for ${account.key}`, probe.json?.data?.authenticated, true);
    for (const path of CORE_PAGES) {
      const res = await request(path, { cookie });
      if (res.status !== 200) {
        bad(`${account.key} ${path}`, `status ${res.status}`);
        continue;
      }
      // A rendered page must contain the real Persian footer, not an empty shell.
      if (res.text.includes("کلیه حقوق محفوظ است")) ok(`${account.key} ${path}`);
      else bad(`${account.key} ${path}`, "page rendered without the footer (empty shell?)");
    }
    for (const path of OPTIONAL_PAGES) {
      const res = await request(path, { cookie });
      if (res.status === 200) ok(`${account.key} ${path}`);
      else if (res.status === 307 && (res.headers.get("location") ?? "").includes("/forbidden")) ok(`${account.key} ${path} (permission denied by design)`);
      else bad(`${account.key} ${path}`, `status ${res.status}`);
    }
    // The navigation must agree with what the role can actually open: a link to a
    // page that redirects to /forbidden would be a phantom control.
    const dashboard = await request("/dashboard", { cookie });
    for (const path of OPTIONAL_PAGES.concat(CORE_PAGES)) {
      const linked = dashboard.text.includes(`href=\"${path}\"`);
      if (!linked) continue;
      const res = await request(path, { cookie });
      if (res.status !== 200) bad(`${account.key} nav link ${path} is not openable`, `status ${res.status}`);
    }
  }

  log("\n== 2. tamper resistance (no step is skippable)");
  const student = sessions.student;
  const admin = sessions.admin;
  let casesResponse = await request("/api/cases", { cookie: student });
  let caseId = casesResponse.json?.data?.items?.[0]?.id;
  if (!caseId) {
    // Start the journey for real: the student creates their own case through the API,
    // using their own profile values (never invented data).
    const account = await request("/account", { cookie: student });
    const studentFullName = (account.text.match(/نام و نام خانوادگی<\/dt><dd[^>]*>([^<]+)</) ?? [])[1];
    const studentNumber = (account.text.match(/شمارهٔ دانشجویی<\/dt><dd[^>]*>([^<]+)</) ?? [])[1];
    if (!studentFullName) bad("student profile name is readable", "name not found on /account");
    const created = await request("/api/cases", {
      cookie: student,
      method: "POST",
      body: {
        studentFullName: studentFullName ?? "کاربر آزمون",
        studentNumber: studentNumber ?? null,
        degreeLevel: "کارشناسی ارشد",
        titleFa: "[DEV] پروندهٔ آزمون پذیرش خودکار",
        titleEn: "[DEV] automated acceptance case",
      },
    });
    if (created.status === 201 || created.status === 200) {
      caseId = created.json?.data?.id ?? created.json?.data?.case?.id;
      ok("student case created for the journey", caseId ?? "");
    } else {
      bad("student case creation", `${created.status} ${created.text.slice(0, 200)}`);
    }
    casesResponse = await request("/api/cases", { cookie: student });
  }
  if (!caseId) bad("student has at least one case", "none found — the journey cannot be verified");
  else {
    ok("student case found", caseId);
    // Forbidden: closing a case needs cases.archive, which a student never has.
    const close = await request(`/api/cases/${caseId}/close`, {
      cookie: student,
      method: "POST",
      body: { reason: "بستن خودسرانه" },
    });
    expect("student cannot close their own case", close.status, 403);
    // Forbidden: deciding a topic version is a reviewer action.
    const topicVersions = await request(`/api/cases/${caseId}/topic/versions`, { cookie: student });
    const versionId = topicVersions.json?.data?.versions?.[0]?.id;
    const decide = await request(`/api/cases/${caseId}/topic/versions/${versionId ?? "00000000-0000-0000-0000-000000000000"}/decision`, {
      cookie: student,
      method: "POST",
      body: { decision: "approve_group", reason: "تأیید خودم" },
    });
    // 403 is the expected answer; a 404 for an unknown version is also acceptable
    // (the request still never reaches a state change).
    expect("student cannot approve their own topic", decide.status === 403 || decide.status === 404, true);
    // Rule engine: graduation cannot start before the preconditions are met.
    const grad = await request(`/api/cases/${caseId}/graduation`, {
      cookie: student,
      method: "POST",
      body: { termId: null, notes: "درخواست زودهنگام" },
    });
    expect("graduation blocked before preconditions", grad.status === 409 || grad.status === 400, true);
    // Missing permission: administrative surfaces are staff-only.
    expect("student cannot read the audit log", (await request("/api/admin/audit", { cookie: student })).status, 403);
    expect("student cannot list users", (await request("/api/admin/users", { cookie: student })).status, 403);
    expect("student cannot edit settings", (await request("/api/admin/settings", { cookie: student, method: "PUT", body: { key: "similarity.maxPercent", value: 99, reason: "افزایش سقف" } })).status, 403);
    // Cross-origin writes are refused even with a valid session.
    const crossOrigin = await request("/api/cases", {
      cookie: admin,
      method: "POST",
      origin: "https://evil.example",
      body: {},
    });
    expect("cross-origin write refused", crossOrigin.status, 403);
    // A reviewer decision without a reason must be refused.
    const noReason = await request(`/api/cases/${caseId}/extensions`, {
      cookie: admin,
      method: "POST",
      body: { terms: 1 },
    });
    expect("extension without a reason refused", noReason.status === 400, true);
  }

  log("\n== 3. downloads are real files");
  if (caseId) {
    const pdf = await request(`/api/cases/${caseId}/pdf`, { cookie: admin });
    if (pdf.status === 200) {
      const magic = Buffer.from(pdf.text.slice(0, 5), "binary").toString("latin1");
      expect("case PDF is a real PDF", magic.startsWith("%PDF"), true);
    } else {
      bad("case PDF download", `status ${pdf.status}`);
    }
    const csv = await request("/api/reports/cases?format=csv", { cookie: admin });
    expect("report CSV", csv.status, 200);
    const xlsx = await request("/api/reports/cases?format=xlsx", { cookie: admin });
    expect("report XLSX", xlsx.status, 200);
    expect("XLSX is a zip container", xlsx.text.slice(0, 2) === "PK", true);
  }

  log("\n== 4. search scope");
  const search = await request("/api/search?q=پرونده", { cookie: student });
  expect("search endpoint answers", search.status, 200);
  expect("search returns hits", Array.isArray(search.json?.data?.hits), true);
  const shortQuery = await request("/api/search?q=a", { cookie: student });
  expect("too-short search query refused", shortQuery.status, 400);
  const wildcards = await request("/api/search?q=%25%25", { cookie: student });
  expect("wildcard search term answered", wildcards.status, 200);
  expect("wildcards did not match everything", (wildcards.json?.data?.hits ?? [null]).length, 0);

  log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) {
    log(`acceptance FAILED (${failures} failing checks)`);
    process.exit(1);
  }
  log("acceptance PASSED");
}

main().catch((error) => {
  console.error(`acceptance aborted: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
