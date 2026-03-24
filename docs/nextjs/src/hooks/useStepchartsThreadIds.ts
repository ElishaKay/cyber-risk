"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "cyber_risk_thread_ids";
const MAX_THREADS = 50;

function generateThreadId() {
  return crypto.randomUUID();
}

function loadThreadIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveThreadIds(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.slice(0, MAX_THREADS)));
  } catch {
    // ignore
  }
}

/**
 * Persisted list of cyber_risk thread IDs for the dropdown.
 * New threads are prepended; list is capped at MAX_THREADS.
 */
export function useStepchartsThreadIds() {
  const [threadIds, setThreadIds] = useState<string[]>([]);
  const [threadId, setThreadIdState] = useState<string>(() => generateThreadId());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = loadThreadIds();
    if (stored.length > 0) {
      setThreadIds(stored);
      setThreadIdState(stored[0]);
    } else {
      const initial = generateThreadId();
      setThreadIdState(initial);
      setThreadIds([initial]);
      saveThreadIds([initial]);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveThreadIds(threadIds);
  }, [threadIds, hydrated]);

  const setThreadId = useCallback((id: string) => {
    setThreadIdState(id);
    setThreadIds((prev) => {
      const next = [id, ...prev.filter((x) => x !== id)].slice(0, MAX_THREADS);
      return next;
    });
  }, []);

  const addNewThread = useCallback(() => {
    const newId = generateThreadId();
    setThreadIdState(newId);
    setThreadIds((prev) => [newId, ...prev.filter((x) => x !== newId)].slice(0, MAX_THREADS));
    return newId;
  }, []);

  return { threadIds, threadId, setThreadId, addNewThread, hydrated };
}
