import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  push: (message: string, action?: ToastItem['action'], duration?: number) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const push = useCallback((message: string, action?: ToastItem['action'], duration = 4000) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((current) => [...current, { id, message, action }]);
    window.setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);
  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <div className="toast-stack">
        {items.map((item) => (
          <div className="toast" key={item.id}>
            <div className="min-w-0">{item.message}</div>
            {item.action ? (
              <button
                type="button"
                className="mt-2 text-[13px] underline"
                onClick={() => {
                  item.action?.onClick();
                  dismiss(item.id);
                }}
              >
                {item.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('Toast missing');
  return value;
}
