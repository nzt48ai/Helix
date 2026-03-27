import React, { useCallback, useEffect, useMemo, useState } from "react";

function toSafeString(value, fallback = "Unknown error") {
  if (typeof value === "string" && value.trim()) return value;
  if (value instanceof Error) return value.message || fallback;
  if (value && typeof value === "object" && typeof value.message === "string" && value.message.trim()) return value.message;
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" ? serialized : fallback;
  } catch {
    return fallback;
  }
}

function toSafeStack(value) {
  if (value instanceof Error && typeof value.stack === "string") return value.stack;
  if (value && typeof value === "object" && typeof value.stack === "string") return value.stack;
  return "";
}

function toIsoTimestamp(value) {
  const date = value instanceof Date ? value : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

export function isDebugModeEnabled(search = typeof window !== "undefined" ? window.location.search : "") {
  if (!search) return false;
  try {
    return new URLSearchParams(search).get("debug") === "1";
  } catch {
    return false;
  }
}

function formatDebugEvent({ source, message, stack = "", componentStack = "", extra = "" }) {
  return {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source,
    message: toSafeString(message),
    stack: toSafeString(stack, ""),
    componentStack: toSafeString(componentStack, ""),
    extra: toSafeString(extra, ""),
    timestamp: toIsoTimestamp(),
  };
}

class DebugErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    this.props.onRenderError?.(
      formatDebugEvent({
        source: "render",
        message: error,
        stack: toSafeStack(error),
        componentStack: info?.componentStack || "",
      })
    );
  }

  render() {
    if (!this.props.enabled) return this.props.children;

    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-red-400/60 bg-red-50/90 p-4 text-sm text-red-900 shadow-sm">
          <div className="font-semibold">Render error captured.</div>
          <div className="mt-1 text-red-800/90">
            The active view crashed. Open the debug panel for full details and stack traces.
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function DebugPanel({ events }) {
  const hasEvents = events.length > 0;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[9999] flex justify-center px-3 pb-3">
      <div className="pointer-events-auto w-full max-w-[840px] overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2.5">
          <div className="text-xs font-semibold uppercase tracking-[0.16em]">Debug Mode (?debug=1)</div>
          <div className="text-xs text-slate-400">{events.length} event(s)</div>
        </div>
        <div className="max-h-[38vh] overflow-auto px-4 py-3 text-xs leading-relaxed">
          {!hasEvents ? <div className="text-slate-400">No runtime errors captured yet.</div> : null}
          {events.map((event) => (
            <div key={event.id} className="mb-3 rounded-xl border border-slate-700 bg-slate-900/80 p-3">
              <div className="mb-1 font-semibold text-rose-300">
                [{event.source}] {event.message}
              </div>
              <div className="mb-2 text-[11px] text-slate-400">{event.timestamp}</div>
              {event.extra ? <pre className="mb-2 whitespace-pre-wrap text-[11px] text-amber-200">{event.extra}</pre> : null}
              {event.componentStack ? (
                <pre className="mb-2 whitespace-pre-wrap text-[11px] text-cyan-200">{event.componentStack}</pre>
              ) : null}
              {event.stack ? <pre className="whitespace-pre-wrap text-[11px] text-slate-300">{event.stack}</pre> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DebugRuntimeCapture({ enabled = false, children }) {
  const [events, setEvents] = useState([]);

  const addEvent = useCallback((event) => {
    setEvents((prev) => [event, ...prev].slice(0, 30));
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    const onWindowError = (event) => {
      addEvent(
        formatDebugEvent({
          source: "window.onerror",
          message: event?.message || event?.error || "Unknown window error",
          stack: toSafeStack(event?.error),
          extra: [event?.filename, event?.lineno, event?.colno].filter(Boolean).join(":"),
        })
      );
    };

    const onUnhandledRejection = (event) => {
      const reason = event?.reason;
      addEvent(
        formatDebugEvent({
          source: "unhandledrejection",
          message: toSafeString(reason),
          stack: toSafeStack(reason),
        })
      );
    };

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [addEvent, enabled]);

  const panel = useMemo(() => (enabled ? <DebugPanel events={events} /> : null), [enabled, events]);

  return (
    <>
      <DebugErrorBoundary enabled={enabled} onRenderError={addEvent}>
        {children}
      </DebugErrorBoundary>
      {panel}
    </>
  );
}
