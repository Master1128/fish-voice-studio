"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceItem, VoiceListResponse } from "@/lib/types";
import type { AppKeys } from "@/lib/client";
import {
  apiFetch,
  loadFavorites,
  loadMyVoices,
  saveFavorites,
  saveMyVoices,
} from "@/lib/client";
import { LANGUAGES } from "@/lib/constants";
import { Badge, Btn, EmptyState, Input, Select, Spinner } from "./ui";
import { VoiceCard } from "./VoiceCard";
import type { KeyAvailability } from "./Studio";

interface Props {
  keys: AppKeys;
  avail: KeyAvailability;
  onUseVoice: (voice: VoiceItem) => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export function VoiceLibrary({ keys, avail, onUseVoice, toast }: Props) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [sortBy, setSortBy] = useState("task_count");
  const [items, setItems] = useState<VoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [total, setTotal] = useState(0);
  const [favorites, setFavorites] = useState<VoiceItem[]>([]);
  const [myVoices, setMyVoices] = useState<VoiceItem[]>([]);
  const [customId, setCustomId] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFavorites(loadFavorites());
     
    setMyVoices(loadMyVoices());
  }, []);

  const fetchVoices = useCallback(
    async (page: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page_size: "24",
          page_number: String(page),
          sort_by: sortBy,
        });
        if (query.trim()) params.set("title", query.trim());
        if (language) params.set("language", language);
        const data = await apiFetch<VoiceListResponse>(`/api/voices?${params}`, keys);
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setTotal(data.total ?? 0);
        setPageNumber(page);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error cargando voces");
      } finally {
        setLoading(false);
      }
    },
    [query, language, sortBy, keys]
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchVoices(1, false), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchVoices]);

  // voces propias de la cuenta de Fish (clonadas), también si la key está en Vercel env
  useEffect(() => {
    if (!avail.fish) return;
    apiFetch<VoiceListResponse>("/api/voices?self=true&page_size=50&sort_by=created_at", keys)
      .then((data) => {
        const mine = data.items || [];
        if (mine.length) {
          setMyVoices(mine);
          saveMyVoices(mine);
        }
      })
      .catch(() => {});
  }, [avail.fish, keys]);

  const toggleFavorite = (voice: VoiceItem) => {
    setFavorites((prev) => {
      const next = prev.some((f) => f._id === voice._id)
        ? prev.filter((f) => f._id !== voice._id)
        : [voice, ...prev];
      saveFavorites(next);
      return next;
    });
  };

  const addCustom = async () => {
    const id = customId.trim();
    if (!id) return;
    try {
      const voice = await apiFetch<VoiceItem>(`/api/voice/${id}`, keys);
      setMyVoices((prev) => {
        const next = [voice, ...prev.filter((v) => v._id !== id)];
        saveMyVoices(next);
        return next;
      });
      setCustomId("");
      toast(`Voz «${voice.title}» añadida a mis voces`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo añadir la voz", "error");
    }
  };

  const favoriteIds = new Set(favorites.map((f) => f._id));

  return (
    <div className="space-y-6">
      <div className="grid gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:grid-cols-[1fr_180px_180px]">
        <Input
          placeholder="Buscar entre miles de voces por nombre…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          options={[{ value: "", label: "Todos los idiomas" }, ...LANGUAGES.map((l) => ({ value: l.code, label: l.label }))]}
        />
        <Select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          options={[
            { value: "task_count", label: "Más usadas" },
            { value: "created_at", label: "Más recientes" },
            { value: "score", label: "Relevancia" },
          ]}
        />
      </div>

      {/* mis voces */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            Mis voces <Badge>clonadas y manuales</Badge>
          </h2>
          <div className="flex gap-2">
            <Input
              placeholder="Pegar id de voz (reference_id)…"
              value={customId}
              onChange={(e) => setCustomId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustom()}
              className="!w-64"
            />
            <Btn onClick={addCustom} disabled={!customId.trim()}>
              Añadir
            </Btn>
          </div>
        </div>
        {myVoices.length === 0 ? (
          <EmptyState
            icon="🎤"
            title="Aún no tienes voces propias"
            hint="Clona tu voz en la pestaña «Clonar voz», o pega aquí el id de cualquier voz de fish.audio (botón «Copy Model Id»)."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {myVoices.map((voice) => (
              <VoiceCard
                key={voice._id}
                voice={voice}
                onUse={onUseVoice}
                isFavorite={favoriteIds.has(voice._id)}
                onFavorite={toggleFavorite}
                actions={
                  <button
                    title="Quitar de mis voces"
                    onClick={() =>
                      setMyVoices((prev) => {
                        const next = prev.filter((v) => v._id !== voice._id);
                        saveMyVoices(next);
                        return next;
                      })
                    }
                    className="cursor-pointer rounded-md px-1.5 py-1 text-xs text-zinc-600 hover:text-red-400"
                  >
                    🗑
                  </button>
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* favoritas */}
      {favorites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-200">
            Favoritas <span className="text-zinc-600">({favorites.length})</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {favorites.map((voice) => (
              <VoiceCard
                key={voice._id}
                voice={voice}
                onUse={onUseVoice}
                isFavorite
                onFavorite={toggleFavorite}
              />
            ))}
          </div>
        </section>
      )}

      {/* librería pública */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-200">
          Librería pública{" "}
          {total > 0 && <span className="text-zinc-600">· {total.toLocaleString()} voces encontradas</span>}
        </h2>
        {error && <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{error}</p>}
        {!loading && items.length === 0 && !error ? (
          <EmptyState icon="🔍" title="Sin resultados" hint="Prueba otro término de búsqueda o idioma." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((voice) => (
              <VoiceCard
                key={voice._id}
                voice={voice}
                onUse={onUseVoice}
                isFavorite={favoriteIds.has(voice._id)}
                onFavorite={toggleFavorite}
              />
            ))}
          </div>
        )}
        {loading && (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        )}
        {!loading && items.length > 0 && items.length < Math.min(total, 1000) && (
          <div className="flex justify-center">
            <Btn onClick={() => fetchVoices(pageNumber + 1, true)}>Cargar más voces</Btn>
          </div>
        )}
        {items.length >= 1000 && (
          <p className="text-center text-[11px] text-zinc-500">
            La API pública muestra un máximo de 1000 resultados; afina la búsqueda para descubrir
            más voces.
          </p>
        )}
      </section>
    </div>
  );
}
