"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceItem, VoiceListResponse } from "@/lib/types";
import type { AppKeys } from "@/lib/client";
import { apiFetch, loadFavorites } from "@/lib/client";
import { LANGUAGES, TAGS } from "@/lib/constants";
import { Badge, Btn, EmptyState, Input, Modal, Select, Spinner } from "./ui";
import { VoiceCard } from "./VoiceCard";

interface Props {
  open: boolean;
  onClose: () => void;
  keys: AppKeys;
  onSelect: (voice: VoiceItem) => void;
  title?: string;
}

export function VoicePicker({ open, onClose, keys, onSelect, title }: Props) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [tag, setTag] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const [items, setItems] = useState<VoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [total, setTotal] = useState(0);
  const [favorites, setFavorites] = useState<VoiceItem[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setFavorites(loadFavorites()), []);

  const fetchVoices = useCallback(
    async (page: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page_size: "20",
          page_number: String(page),
          sort_by: sortBy,
        });
        if (query.trim()) params.set("title", query.trim());
        if (language) params.set("language", language);
        if (tag) params.set("tag", tag);
        const data = await apiFetch<VoiceListResponse>(`/api/voices?${params}`, keys);
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setTotal(data.total ?? data.items.length);
        setPageNumber(page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error buscando voces");
      } finally {
        setLoading(false);
      }
    },
    [query, language, tag, sortBy, keys]
  );

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchVoices(1, false), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, fetchVoices]);

  const favoriteIds = new Set(favorites.map((f) => f._id));

  return (
    <Modal open={open} onClose={onClose} title={title || "Elegir voz"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="col-span-2">
            <Input
              placeholder="Buscar por nombre…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            options={[{ value: "", label: "Todos los idiomas" }, ...LANGUAGES.map((l) => ({ value: l.code, label: l.label }))]}
          />
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            options={[
              { value: "score", label: "Relevancia" },
              { value: "task_count", label: "Más usadas" },
              { value: "created_at", label: "Más recientes" },
            ]}
          />
        </div>

        {tag && (
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            Etiqueta: <Badge tone="cyan">{tag}</Badge>
            <button className="cursor-pointer text-zinc-500 underline hover:text-zinc-300" onClick={() => setTag("")}>
              quitar
            </button>
          </div>
        )}

        {favorites.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Favoritas</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {favorites.slice(0, 6).map((voice) => (
                <VoiceCard
                  key={`fav-${voice._id}`}
                  voice={voice}
                  isFavorite
                  onUse={(v) => {
                    onSelect(v);
                    onClose();
                  }}
                />
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Librería pública {total > 0 && <span className="text-zinc-600">· {total.toLocaleString()} resultados</span>}
            </h3>
            <div className="flex gap-1.5">
              {TAGS.slice(0, 6).map((t) => (
                <button
                  key={t}
                  onClick={() => setTag(tag === t ? "" : t)}
                  className={`cursor-pointer rounded-full border px-2 py-0.5 text-[10px] transition-colors ${tag === t ? "border-cyan-600 bg-cyan-900/40 text-cyan-300" : "border-zinc-700 text-zinc-400 hover:border-zinc-500"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}

          {items.length === 0 && !loading && !error ? (
            <EmptyState icon="🔍" title="Sin resultados" hint="Prueba con otro término, idioma o etiqueta." />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((voice) => (
                <VoiceCard
                  key={voice._id}
                  voice={voice}
                  isFavorite={favoriteIds.has(voice._id)}
                  onUse={(v) => {
                    onSelect(v);
                    onClose();
                  }}
                />
              ))}
            </div>
          )}

          {loading && (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          )}

          {items.length > 0 && items.length < total && !loading && (
            <div className="flex justify-center pt-1">
              <Btn onClick={() => fetchVoices(pageNumber + 1, true)}>Cargar más</Btn>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
