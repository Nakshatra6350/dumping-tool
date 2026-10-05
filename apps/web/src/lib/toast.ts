import { useSyncExternalStore } from "react";

export interface Toast {
  id: number;
  type: "success" | "error" | "info";
  title: string;
  message?: string;
  leaving?: boolean;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const dismissToast = (id: number): void => {
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 280);
};

/** Shows a short message in the corner. Errors stay a little longer. */
export const toast = (input: Omit<Toast, "id" | "leaving">): void => {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { ...input, id }];
  emit();
  setTimeout(() => dismissToast(id), input.type === "error" ? 8000 : 4500);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useToasts = (): Toast[] => useSyncExternalStore(subscribe, () => toasts);
