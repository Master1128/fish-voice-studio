"use client";

import { useEffect, useState, type ReactNode, type ButtonHTMLAttributes } from "react";

type BtnVariant = "primary" | "ghost" | "outline" | "danger";

export function Btn({
  variant = "outline",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" | "lg" }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-cyan-400/60 cursor-pointer";
  const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm", lg: "px-5 py-2.5 text-base" };
  const variants: Record<BtnVariant, string> = {
    primary:
      "bg-gradient-to-r from-cyan-500 to-teal-400 text-zinc-950 font-semibold hover:from-cyan-400 hover:to-teal-300 shadow-lg shadow-cyan-500/20",
    ghost: "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60",
    outline: "border border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800",
    danger: "border border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-900/40",
  };
  return (
    <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  right,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</label>
        {right}
      </div>
      {children}
      {hint && <p className="text-[11px] leading-snug text-zinc-500">{hint}</p>}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-cyan-500/70 focus:outline-none";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className || ""}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} resize-none ${props.className || ""}`} />;
}

export function Select({
  options,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string }[];
}) {
  return (
    <select {...props} className={`${inputCls} cursor-pointer ${props.className || ""}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-zinc-900">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Range({
  label,
  value,
  display,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; display: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono text-cyan-300">{display}</span>
      </div>
      <input
        type="range"
        value={value}
        {...props}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-cyan-400 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-400"
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-left transition-colors hover:border-zinc-700"
    >
      <span>
        <span className="block text-sm text-zinc-200">{label}</span>
        {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-cyan-500" : "bg-zinc-700"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}
        />
      </span>
    </button>
  );
}

export function Badge({ children, tone = "zinc" }: { children: ReactNode; tone?: "zinc" | "cyan" | "amber" | "green" | "red" }) {
  const tones = {
    zinc: "bg-zinc-800 text-zinc-300 border-zinc-700",
    cyan: "bg-cyan-950/60 text-cyan-300 border-cyan-800/60",
    amber: "bg-amber-950/60 text-amber-300 border-amber-800/60",
    green: "bg-emerald-950/60 text-emerald-300 border-emerald-800/60",
    red: "bg-red-950/60 text-red-300 border-red-800/60",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl ${wide ? "max-w-4xl" : "max-w-lg"}`}
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          <button onClick={onClose} className="cursor-pointer rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Cerrar">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-400 hover:text-zinc-200"
      >
        {title}
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open && <div className="space-y-4 border-t border-zinc-800 px-3 py-3">{children}</div>}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-cyan-400 ${className}`}
    />
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-800 py-12 text-center">
      <span className="text-3xl">{icon}</span>
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {hint && <p className="max-w-sm text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
