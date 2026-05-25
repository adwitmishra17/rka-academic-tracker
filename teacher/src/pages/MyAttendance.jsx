// =========================================================================
// MyAttendance.jsx
//
// Teacher-facing attendance view for the rka-teacher PWA.
//
// Calls the Supabase Edge Function `get-my-attendance` with the current
// user's Firebase ID token, then renders:
//   - A "Today" card (first IN, last OUT, status pill)
//   - A "Last 30 days" list (one row per date)
//
// Drop-in expectations:
//   - Firebase Auth is initialised somewhere central (e.g. src/firebase.js)
//     and exports `auth` (the firebase/auth instance).
//   - Vite env var VITE_SUPABASE_FUNCTIONS_URL points at your project's
//     Edge Functions base URL, e.g.
//       https://<project-ref>.supabase.co/functions/v1
//   - The accompanying MyAttendance.css is imported (already done below).
//
// The component does NOT include a route or nav entry — wire it into your
// router (e.g. <Route path="/attendance" element={<MyAttendance />} />).
// =========================================================================

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { auth } from "../firebase/config";
import "./MyAttendance.css";

const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;

// India is the only TZ this school operates in. We deliberately compute
// "today" and per-day grouping in IST regardless of the device's TZ, so
// a teacher checking from a phone set to a different TZ still sees their
// school day correctly.
const IST_TZ = "Asia/Kolkata";

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}); // produces "YYYY-MM-DD"

const timeFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dayLabelFmt = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST_TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});

function dayKey(date) {
  return dayKeyFmt.format(date);
}

function todayKey() {
  return dayKey(new Date());
}

/**
 * Group raw events by IST day. Returns Map<dayKey, Event[]> sorted ascending
 * within each day.
 */
function groupEventsByDay(events) {
  const map = new Map();
  for (const evt of events) {
    const d = new Date(evt.event_time);
    const k = dayKey(d);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(evt);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
  }
  return map;
}

/**
 * Build an ordered list of dayKeys covering the requested window
 * (oldest -> newest). We fill in days that have zero events so the list
 * shows continuity instead of mysterious gaps.
 */
function buildDayList(fromIso, toIso) {
  const days = [];
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    days.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function summariseDay(events) {
  if (!events || events.length === 0) {
    return { status: "no-record", inAt: null, outAt: null, count: 0 };
  }
  if (events.length === 1) {
    return {
      status: "single-punch",
      inAt: events[0].event_time,
      outAt: null,
      count: 1,
    };
  }
  return {
    status: "present",
    inAt: events[0].event_time,
    outAt: events[events.length - 1].event_time,
    count: events.length,
  };
}

function StatusPill({ status }) {
  const label = {
    present: "Present",
    "single-punch": "One punch",
    "no-record": "No record",
  }[status];
  return <span className={`rka-pill rka-pill--${status}`}>{label}</span>;
}

// Small back-link shown at the top of every state. Users can't reach /hrms
// from the bottom nav, so this is the only in-app way back to the hub.
function BackToHub() {
  return (
    <Link to="/hrms" className="rka-attendance__back">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      Back to HRMS
    </Link>
  );
}

export default function MyAttendance() {
  const [state, setState] = useState({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const user = auth.currentUser;
        if (!user) {
          // Belt-and-braces; the route should already be auth-gated.
          if (!cancelled) setState({ kind: "signed-out" });
          return;
        }

        // Helper: call get-my-attendance with a fresh token. Used twice for
        // the retry path so we never call with a stale token after a "Failed
        // to fetch" — which is often a CORS-swallowed 401 from token expiry.
        async function callOnce() {
          const token = await user.getIdToken(/* forceRefresh */ true);
          return fetch(`${FUNCTIONS_URL}/get-my-attendance`, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` },
          });
        }

        let res;
        try {
          res = await callOnce();
        } catch (err) {
          // TypeError "Failed to fetch" = network/CORS error. Wait briefly
          // and try once more in case of transient failure. If it still
          // fails, propagate to the outer catch.
          console.warn('get-my-attendance first attempt failed, retrying:', err?.message);
          await new Promise(r => setTimeout(r, 600));
          res = await callOnce();
        }

        const body = await res.json();

        if (!res.ok) {
          if (res.status === 404 && body.error === "no_linked_staff") {
            if (!cancelled) {
              setState({ kind: "not-linked", email: body.email });
            }
            return;
          }
          if (!cancelled) {
            setState({
              kind: "error",
              message: body.message || `Request failed (${res.status}).`,
            });
          }
          return;
        }

        if (!cancelled) setState({ kind: "ready", data: body });
      } catch (err) {
        console.error('get-my-attendance failed permanently:', err);
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              err?.message ??
              "Couldn't reach the server. Check your connection and try again.",
          });
        }
      }
    }

    // If Firebase is still hydrating the user on first paint, wait one tick.
    const unsub = auth.onAuthStateChanged(() => load());
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // ---------- render branches ------------------------------------------

  if (state.kind === "loading") {
    return (
      <main className="rka-attendance">
        <BackToHub />
        <div className="rka-attendance__skeleton" aria-hidden="true">
          <div className="rka-attendance__skeleton-card" />
          <div className="rka-attendance__skeleton-row" />
          <div className="rka-attendance__skeleton-row" />
          <div className="rka-attendance__skeleton-row" />
        </div>
        <p className="rka-attendance__loading-label">Loading your attendance…</p>
      </main>
    );
  }

  if (state.kind === "signed-out") {
    return (
      <main className="rka-attendance">
        <BackToHub />
        <EmptyState
          title="Please sign in"
          message="You need to sign in with your Google account to view attendance."
        />
      </main>
    );
  }

  if (state.kind === "not-linked") {
    return (
      <main className="rka-attendance">
        <BackToHub />
        <EmptyState
          title="Account not yet linked"
          message={
            <>
              Your sign-in email <strong>{state.email}</strong> isn't linked to a
              staff record yet. Please ask the school admin to link it in the
              HRMS, then refresh this page.
            </>
          }
        />
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="rka-attendance">
        <BackToHub />
        <EmptyState
          title="Couldn't load attendance"
          message={state.message}
          tone="error"
        />
      </main>
    );
  }

  // state.kind === "ready"
  return <AttendanceView data={state.data} />;
}

function AttendanceView({ data }) {
  const { employee, range, events } = data;

  const grouped = useMemo(() => groupEventsByDay(events), [events]);
  const days = useMemo(
    () => buildDayList(range.from, range.to),
    [range.from, range.to],
  );

  const today = todayKey();
  const todayEvents = grouped.get(today) ?? [];
  const todaySummary = summariseDay(todayEvents);

  // Show newest first in the list.
  const reversedDays = [...days].reverse();

  return (
    <main className="rka-attendance">
      <BackToHub />
      <header className="rka-attendance__header">
        <p className="rka-attendance__eyebrow">My Attendance</p>
        <h1 className="rka-attendance__name">{employee.name}</h1>
        <p className="rka-attendance__staff-id">
          Biometric ID: <span>{employee.biometric_code ?? "—"}</span>
          <br />
          <small>If this isn't you, contact admin.</small>
        </p>
      </header>

      <section className="rka-today" aria-labelledby="today-heading">
        <div className="rka-today__top">
          <h2 id="today-heading" className="rka-today__title">Today</h2>
          <StatusPill status={todaySummary.status} />
        </div>
        <p className="rka-today__date">
          {dayLabelFmt.format(new Date())}
        </p>
        <div className="rka-today__times">
          <div className="rka-today__time">
            <span className="rka-today__label">In</span>
            <span className="rka-today__value">
              {todaySummary.inAt ? timeFmt.format(new Date(todaySummary.inAt)) : "—"}
            </span>
          </div>
          <div className="rka-today__divider" aria-hidden="true" />
          <div className="rka-today__time">
            <span className="rka-today__label">Out</span>
            <span className="rka-today__value">
              {todaySummary.outAt ? timeFmt.format(new Date(todaySummary.outAt)) : "—"}
            </span>
          </div>
        </div>
        {todaySummary.count > 2 && (
          <p className="rka-today__extra">
            {todaySummary.count} punches recorded today
          </p>
        )}
      </section>

      <section className="rka-history" aria-labelledby="history-heading">
        <h2 id="history-heading" className="rka-history__title">Last 30 days</h2>
        <ol className="rka-history__list">
          {reversedDays.map((k) => {
            const dayEvents = grouped.get(k) ?? [];
            const summary = summariseDay(dayEvents);
            const isToday = k === today;
            return (
              <li
                key={k}
                className={`rka-day ${isToday ? "rka-day--today" : ""}`}
              >
                <div className="rka-day__date">
                  <span className="rka-day__date-main">
                    {dayLabelFmt.format(new Date(k + "T12:00:00"))}
                  </span>
                  {isToday && <span className="rka-day__today-tag">Today</span>}
                </div>
                <div className="rka-day__times">
                  {summary.status === "no-record" ? (
                    <span className="rka-day__no-record">No record</span>
                  ) : (
                    <>
                      <span className="rka-day__time">
                        {summary.inAt ? timeFmt.format(new Date(summary.inAt)) : "—"}
                      </span>
                      <span className="rka-day__arrow" aria-hidden="true">→</span>
                      <span className="rka-day__time">
                        {summary.outAt ? timeFmt.format(new Date(summary.outAt)) : "—"}
                      </span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <p className="rka-attendance__footer">
        Showing {dayLabelFmt.format(new Date(range.from))} – {dayLabelFmt.format(new Date(range.to))}.
        Records are based on biometric punches; talk to admin if anything looks wrong.
      </p>
    </main>
  );
}

function EmptyState({ title, message, tone = "neutral" }) {
  return (
    <div className={`rka-empty rka-empty--${tone}`}>
      <h2 className="rka-empty__title">{title}</h2>
      <p className="rka-empty__message">{message}</p>
    </div>
  );
}
