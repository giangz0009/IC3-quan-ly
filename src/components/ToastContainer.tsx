import React from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';
import {
  TOAST_VARIANT_TITLES,
  type ToastVariant,
} from '../utils/ic3Rules';

export interface ToastItem {
  id: number;
  msg: string;
  variant: ToastVariant;
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

const VARIANT_STYLES: Record<
  ToastVariant,
  {
    container: string;
    badge: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  success: {
    container:
      'bg-[#DFF0D8] border-[#B2D8A7] text-[#2F6A31] dark:bg-emerald-950/95 dark:border-emerald-800 dark:text-emerald-100',
    badge:
      'bg-[#C3E2B9] text-[#2F6A31] dark:bg-emerald-900 dark:text-emerald-300',
    icon: Check,
  },
  warning: {
    container:
      'bg-[#FCF5C7] border-[#E7DA8B] text-[#7A5D12] dark:bg-amber-950/95 dark:border-amber-800 dark:text-amber-100',
    badge:
      'bg-[#EFE19B] text-[#7A5D12] dark:bg-amber-900 dark:text-amber-300',
    icon: AlertTriangle,
  },
  error: {
    container:
      'bg-[#F2D5D3] border-[#DCA5A1] text-[#962823] dark:bg-red-950/95 dark:border-red-800 dark:text-red-100',
    badge:
      'bg-[#E6B8B5] text-[#962823] dark:bg-red-900 dark:text-red-300',
    icon: X,
  },
  info: {
    container:
      'bg-[#D7ECF9] border-[#A3D2EE] text-[#1D5E89] dark:bg-sky-950/95 dark:border-sky-800 dark:text-sky-100',
    badge:
      'bg-[#B5DCF4] text-[#1D5E89] dark:bg-sky-900 dark:text-sky-300',
    icon: Info,
  },
};

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onDismiss,
}) => {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      data-testid="toast-container"
      className="fixed bottom-5 right-5 z-[90] w-[calc(100vw-2.5rem)] max-w-md flex flex-col gap-2.5 pointer-events-none"
    >
      {toasts.map((item) => {
        const style = VARIANT_STYLES[item.variant];
        const Icon = style.icon;
        return (
          <div
            key={item.id}
            role={item.variant === 'error' ? 'alert' : 'status'}
            data-testid="toast-notification"
            data-toast-variant={item.variant}
            className={`pointer-events-auto rounded-xl border shadow-lg px-4 py-3 flex items-center gap-3.5 transition-all ${style.container}`}
          >
            <div
              aria-hidden="true"
              className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center ${style.badge}`}
            >
              <Icon className="w-5 h-5 stroke-[2.3]" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-xs font-extrabold tracking-wide uppercase leading-tight">
                {TOAST_VARIANT_TITLES[item.variant]}
              </div>
              <p className="text-xs leading-snug mt-0.5 opacity-90 break-words">
                {item.msg}
              </p>
            </div>

            <button
              type="button"
              aria-label="Đóng thông báo"
              onClick={() => onDismiss(item.id)}
              className="shrink-0 p-1 rounded-md opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
