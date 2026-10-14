import type { MetadataRoute } from "next";

/**
 * M14 — crawler policy.
 *
 * The system stores personal data of students and staff: it must never be indexed.
 * The policy is repeated as an `X-Robots-Tag` header so it also applies to responses
 * that a crawler fetches without reading this file.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: "/",
      },
    ],
  };
}
