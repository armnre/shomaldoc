"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui";
import { useI18n } from "@/i18n/provider";
import { formatDateTime, formatNumber } from "@/lib/format";
import { apiRequest } from "./api-client";

export interface NotificationItem {
  id: string;
  kind: string;
  titleFa: string;
  bodyFa: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

/**
 * Real in-app notification centre: unread counter, list, mark-one and mark-all.
 * Polling keeps the badge live without a websocket dependency.
 */
export function NotificationCenter() {
  const { dict, locale } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Subscription to an external source (the API) with polling; state is only
  // updated from the async callback, never synchronously in the effect body.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await apiRequest<{ items: NotificationItem[]; unread: number }>("/api/notifications", "GET");
      if (!alive || !r.ok) return;
      setItems(r.data.items);
      setUnread(r.data.unread);
    };
    void tick();
    const t = setInterval(() => void tick(), 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const load = useCallback(async () => {
    const r = await apiRequest<{ items: NotificationItem[]; unread: number }>("/api/notifications", "GET");
    if (r.ok) {
      setItems(r.data.items);
      setUnread(r.data.unread);
    }
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const markOne = async (item: NotificationItem) => {
    if (!item.isRead) {
      setBusy(true);
      await apiRequest(`/api/notifications/${item.id}/read`, "POST", {});
      setBusy(false);
    }
    setOpen(false);
    if (item.link) router.push(item.link);
    void load();
  };

  const markAll = async () => {
    setBusy(true);
    await apiRequest("/api/notifications?action=read-all", "POST", {});
    setBusy(false);
    void load();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); if (!open) void load(); }}
        aria-label={dict.common.notifications}
        aria-expanded={open}
        aria-haspopup="true"
        className="relative grid size-10 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 ? (
          <span className="absolute -top-0.5 -end-0.5 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[0.65rem] font-bold text-accent-fg tabular">
            {formatNumber(unread, locale)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute end-0 z-[var(--z-dropdown)] mt-2 w-80 max-w-[90vw] animate-pop rounded-lg border border-border bg-surface p-2 shadow-lift">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <p className="text-sm font-semibold">{dict.common.notifications}</p>
            {unread > 0 ? (
              <button type="button" onClick={markAll} disabled={busy} className="text-xs font-medium text-primary hover:underline disabled:opacity-60">
                {dict.notifications.markAll}
              </button>
            ) : null}
          </div>
          <hr className="my-1 border-border" />
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-fg-muted">{dict.common.noNotifications}</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => markOne(n)}
                    className={n.isRead ? "block w-full rounded-md px-3 py-2 text-start text-sm hover:bg-surface-2" : "block w-full rounded-md bg-primary-soft/50 px-3 py-2 text-start text-sm hover:bg-surface-2"}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-medium">{n.titleFa}</span>
                      {!n.isRead ? <Badge tone="accent">{dict.notifications.unread}</Badge> : null}
                    </span>
                    {n.bodyFa ? <span className="mt-0.5 block text-xs text-fg-muted">{n.bodyFa}</span> : null}
                    <span className="mt-1 block text-[0.7rem] text-fg-muted tabular">{formatDateTime(n.createdAt, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
