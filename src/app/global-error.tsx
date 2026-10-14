"use client";

/** Last-resort boundary when the root layout itself fails. It must not depend on providers. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fa" dir="rtl">
      <body style={{ fontFamily: "Tahoma, sans-serif", background: "#f8f5ee", color: "#1b2135", margin: 0 }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
          <section style={{ maxWidth: 480, textAlign: "center", background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 8px 24px rgba(18,26,66,.12)" }}>
            <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>خطای داخلی سامانه</h1>
            <p style={{ color: "#5a6175" }}>مشکلی پیش آمده است. لطفاً دوباره تلاش کنید.</p>
            <button type="button" onClick={() => reset()} style={{ marginTop: 16, background: "#222f74", color: "#fff", border: 0, borderRadius: 8, padding: "10px 20px", cursor: "pointer" }}>
              تلاش دوباره
            </button>
          </section>
        </main>
      </body>
    </html>
  );
}
