import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

type WsMessage = { type: string; payload: unknown };
type Handler = (payload: unknown) => void;

export type WsEventMap = {
  [eventType: string]: Handler;
};

/**
 * useWebSocket — connects to the server's /ws endpoint, dispatches typed
 * events to handlers, and reconnects with backoff.
 *
 * Pass an `invalidate` map to invalidate React Query keys on specific events.
 */
export function useWebSocket(opts: {
  handlers?: WsEventMap;
  invalidate?: Record<string, readonly unknown[]>;
}): void {
  const qc = useQueryClient();
  const handlersRef = useRef(opts.handlers);
  const invalidateRef = useRef(opts.invalidate);
  handlersRef.current = opts.handlers;
  invalidateRef.current = opts.invalidate;

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${proto}://${window.location.host}/ws`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        retry = 0;
      };

      socket.onmessage = (event) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(event.data as string) as WsMessage;
        } catch {
          return;
        }
        handlersRef.current?.[msg.type]?.(msg.payload);
        const key = invalidateRef.current?.[msg.type];
        if (key) {
          qc.invalidateQueries({ queryKey: key as unknown[] });
        }
      };

      socket.onclose = () => {
        if (cancelled) return;
        retry = Math.min(retry + 1, 6);
        const delay = Math.min(1000 * 2 ** retry, 30_000);
        timer = setTimeout(connect, delay);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [qc]);
}
