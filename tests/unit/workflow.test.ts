import { describe, expect, it } from "vitest";
import {
  CASE_STATUSES,
  STATUS_MAP,
  statusLabelFa,
  isCaseStatus,
  getAvailableTransitions,
  findTransition,
  assertTransitionValid,
} from "@/server/workflows";
import { AppError } from "@/server/http";

describe("workflow statuses", () => {
  it("has exactly 7 verifiable statuses", () => {
    expect(CASE_STATUSES).toHaveLength(7);
    expect(CASE_STATUSES.map((s) => s.key)).toEqual([
      "draft",
      "submitted",
      "under_review",
      "revision_required",
      "approved",
      "rejected",
      "archived",
    ]);
  });

  it("STATUS_MAP contains all statuses", () => {
    for (const s of CASE_STATUSES) {
      expect(STATUS_MAP[s.key]).toBeDefined();
      expect(STATUS_MAP[s.key].fa).toBe(s.fa);
    }
  });

  it("statusLabelFa returns Persian label for valid keys and echoes unknown keys", () => {
    expect(statusLabelFa("draft")).toBe("پیش‌نویس");
    expect(statusLabelFa("submitted")).toBe("ثبت‌شده برای بررسی");
    expect(statusLabelFa("unknown_key")).toBe("unknown_key");
  });

  it("isCaseStatus correctly guards", () => {
    expect(isCaseStatus("draft")).toBe(true);
    expect(isCaseStatus("approved")).toBe(true);
    expect(isCaseStatus("nonexistent")).toBe(false);
    expect(isCaseStatus("")).toBe(false);
  });
});

describe("workflow transitions", () => {
  it("findTransition returns the correct definition for a valid move", () => {
    const def = findTransition("draft", "submitted");
    expect(def).not.toBeNull();
    expect(def!.label).toContain("ارسال");
    expect(def!.reasonRequired).toBe(false);
  });

  it("findTransition returns null for an undefined move", () => {
    expect(findTransition("draft", "approved")).toBeNull();
    expect(findTransition("archived", "draft")).toBeNull();
  });

  it("getAvailableTransitions returns moves from a given status", () => {
    const fromSubmitted = getAvailableTransitions("submitted");
    expect(fromSubmitted.map((t) => t.to)).toContain("under_review");
    expect(fromSubmitted.map((t) => t.to)).toContain("revision_required");
    expect(fromSubmitted.map((t) => t.to)).toContain("approved");
    expect(fromSubmitted.map((t) => t.to)).toContain("rejected");
    // submitted → submitted is not a valid self-loop
    expect(fromSubmitted.map((t) => t.to)).not.toContain("submitted");
  });

  it("getAvailableTransitions returns empty for archived (terminal status)", () => {
    expect(getAvailableTransitions("archived")).toEqual([]);
  });

  it("getAvailableTransitions returns empty for unknown status", () => {
    expect(getAvailableTransitions("nonexistent")).toEqual([]);
  });

  it("assertTransitionValid does not throw for a valid move", () => {
    expect(() => assertTransitionValid("draft", "submitted")).not.toThrow();
  });

  it("assertTransitionValid throws 409 for an invalid move", () => {
    try {
      assertTransitionValid("draft", "approved");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(409);
      expect((e as AppError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("assertTransitionValid throws 400 for a completely unknown target", () => {
    try {
      assertTransitionValid("draft", "fake_status");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(400);
      expect((e as AppError).code).toBe("INVALID_STATUS");
    }
  });

  it("revision_required transitions: student can resubmit, reviewer can approve/reject", () => {
    const fromRevision = getAvailableTransitions("revision_required");
    const targets = fromRevision.map((t) => t.to);
    expect(targets).toContain("submitted");   // student resubmits
    expect(targets).toContain("approved");    // reviewer approves
    expect(targets).toContain("rejected");   // reviewer rejects
  });

  it("archival is only from approved or rejected", () => {
    expect(findTransition("approved", "archived")).not.toBeNull();
    expect(findTransition("rejected", "archived")).not.toBeNull();
    expect(findTransition("draft", "archived")).toBeNull();
    expect(findTransition("submitted", "archived")).toBeNull();
  });

  it("review transitions require review_topic permission", () => {
    const def = findTransition("submitted", "under_review");
    expect(def!.requiredPermission).toBe("cases.review_topic");
  });

  it("reject and revision_required demand a reason", () => {
    const reject = findTransition("submitted", "rejected");
    expect(reject!.reasonRequired).toBe(true);
    const revision = findTransition("submitted", "revision_required");
    expect(revision!.reasonRequired).toBe(true);
  });
});