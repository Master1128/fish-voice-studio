"use client";

import { useMemo, useRef, useState } from "react";
import type {
  PronunciationDictionarySettings,
  PronunciationRule,
} from "@/lib/types";
import {
  createDefaultPronunciationDictionary,
  MAX_PRONUNCIATION_RULES,
  mergePronunciationDictionaries,
  parsePronunciationDictionaryJson,
  pronunciationSourceKey,
} from "@/lib/pronunciationDictionary";
import { downloadText } from "@/lib/client";
import { Badge, Btn, Collapsible, EmptyState, Field, Input, Modal, Toggle } from "./ui";

interface Props {
  settings: PronunciationDictionarySettings;
  onChange: (settings: PronunciationDictionarySettings) => void;
  toast: (message: string, type?: "success" | "error" | "info") => void;
}

function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function PronunciationDictionaryEditor({ settings, onChange, toast }: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [replacement, setReplacement] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PronunciationDictionarySettings | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeCount = settings.rules.filter((rule) => rule.enabled).length;
  const visibleRules = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("es");
    if (!q) return settings.rules;
    return settings.rules.filter(
      (rule) =>
        rule.source.toLocaleLowerCase("es").includes(q) ||
        rule.replacement.toLocaleLowerCase("es").includes(q)
    );
  }, [query, settings.rules]);

  const resetForm = () => {
    setSource("");
    setReplacement("");
    setEditingId(null);
  };

  const saveRule = () => {
    const cleanSource = source.normalize("NFC").replace(/\s+/g, " ").trim();
    const cleanReplacement = replacement.normalize("NFC").trim();
    if (!cleanSource || !cleanReplacement) {
      toast("Completa el texto original y la pronunciación", "error");
      return;
    }
    const duplicate = settings.rules.find(
      (rule) =>
        rule.id !== editingId &&
        pronunciationSourceKey(rule.source) === pronunciationSourceKey(cleanSource)
    );
    if (duplicate) {
      toast(`Ya existe una regla para «${duplicate.source}»`, "error");
      return;
    }
    if (!editingId && settings.rules.length >= MAX_PRONUNCIATION_RULES) {
      toast(`El diccionario admite un máximo de ${MAX_PRONUNCIATION_RULES} reglas`, "error");
      return;
    }

    const rules = editingId
      ? settings.rules.map((rule) =>
          rule.id === editingId
            ? { ...rule, source: cleanSource, replacement: cleanReplacement }
            : rule
        )
      : [
          ...settings.rules,
          { id: newId(), source: cleanSource, replacement: cleanReplacement, enabled: true },
        ];
    onChange({ ...settings, rules });
    toast(editingId ? "Regla actualizada" : "Pronunciación añadida", "success");
    resetForm();
  };

  const editRule = (rule: PronunciationRule) => {
    setEditingId(rule.id);
    setSource(rule.source);
    setReplacement(rule.replacement);
  };

  const removeRule = (rule: PronunciationRule) => {
    if (!window.confirm(`¿Eliminar la regla «${rule.source} → ${rule.replacement}»?`)) return;
    onChange({ ...settings, rules: settings.rules.filter((item) => item.id !== rule.id) });
    if (editingId === rule.id) resetForm();
    toast("Regla eliminada", "success");
  };

  const exportDictionary = () => {
    const payload = {
      ...settings,
      exportedAt: new Date().toISOString(),
    };
    downloadText(
      JSON.stringify(payload, null, 2),
      `fish-voice-pronunciaciones-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json"
    );
    toast("Diccionario exportado", "success");
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const result = parsePronunciationDictionaryJson(text);
      setPendingImport(result.settings);
      if (result.warnings.length) toast(result.warnings.join(" "), "info");
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo importar el archivo", "error");
    }
  };

  const applyImport = (mode: "merge" | "replace") => {
    if (!pendingImport) return;
    onChange(
      mode === "merge"
        ? mergePronunciationDictionaries(settings, pendingImport)
        : pendingImport
    );
    setPendingImport(null);
    toast(mode === "merge" ? "Diccionario combinado" : "Diccionario reemplazado", "success");
  };

  const resetDictionary = () => {
    if (!window.confirm("¿Restablecer el diccionario? Se perderán las reglas personalizadas.")) return;
    onChange(createDefaultPronunciationDictionary());
    resetForm();
    toast("Diccionario restablecido", "success");
  };

  return (
    <>
      <Collapsible title="Diccionario de pronunciación" defaultOpen>
        <Toggle
          checked={settings.enabled}
          onChange={(enabled) => onChange({ ...settings, enabled })}
          label="Aplicar diccionario personalizado"
          hint="Corrige palabras problemáticas solo en la copia enviada al sintetizador."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={settings.enabled ? "green" : "zinc"}>
            {activeCount} activa{activeCount === 1 ? "" : "s"} de {settings.rules.length}
          </Badge>
          {settings.rules[0] && (
            <span className="text-[11px] text-zinc-500">
              Ejemplo: <span className="text-cyan-300">{settings.rules[0].source}</span> →{" "}
              <span className="text-cyan-300">{settings.rules[0].replacement}</span>
            </span>
          )}
        </div>
        <Btn onClick={() => setOpen(true)}>Gestionar diccionario</Btn>
        <p className="text-[11px] leading-snug text-zinc-500">
          Las reglas se guardan en este navegador. Usa Exportar/Importar para compartirlas o hacer
          una copia de seguridad.
        </p>
      </Collapsible>

      <Modal open={open} onClose={() => setOpen(false)} title="Diccionario de pronunciación" wide>
        <div className="space-y-5">
          <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h3 className="text-sm font-semibold text-zinc-200">
              {editingId ? "Editar pronunciación" : "Añadir pronunciación"}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Texto original" hint="Palabra o frase completa, por ejemplo: mengüe">
                <Input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="mengüe"
                  maxLength={100}
                />
              </Field>
              <Field label="Pronunciación TTS" hint="Escritura fonética que pronuncia bien la voz">
                <Input
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                  placeholder="méngüe"
                  maxLength={200}
                  onKeyDown={(e) => e.key === "Enter" && saveRule()}
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Btn variant="primary" onClick={saveRule}>
                {editingId ? "Guardar cambios" : "Añadir regla"}
              </Btn>
              {editingId && (
                <Btn variant="ghost" onClick={resetForm}>
                  Cancelar edición
                </Btn>
              )}
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar regla…"
              className="!w-64"
            />
            <div className="ml-auto flex flex-wrap gap-2">
              <Btn onClick={() => fileRef.current?.click()}>Importar JSON</Btn>
              <Btn onClick={exportDictionary} disabled={!settings.rules.length}>
                Exportar JSON
              </Btn>
              <Btn variant="danger" onClick={resetDictionary}>
                Restablecer
              </Btn>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
                e.target.value = "";
              }}
            />
          </div>

          {pendingImport && (
            <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-3 text-xs text-amber-200">
              <p className="mb-2">
                El archivo contiene {pendingImport.rules.length} regla(s). ¿Cómo quieres importarlo?
              </p>
              <div className="flex gap-2">
                <Btn size="sm" onClick={() => applyImport("merge")}>
                  Combinar
                </Btn>
                <Btn size="sm" variant="danger" onClick={() => applyImport("replace")}>
                  Reemplazar todo
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => setPendingImport(null)}>
                  Cancelar
                </Btn>
              </div>
            </div>
          )}

          {visibleRules.length === 0 ? (
            <EmptyState
              icon="🔤"
              title={settings.rules.length ? "Sin resultados" : "Diccionario vacío"}
              hint="Añade una palabra y la forma en que quieres que el sintetizador la pronuncie."
            />
          ) : (
            <div className="space-y-2">
              {visibleRules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"
                >
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...settings,
                        rules: settings.rules.map((item) =>
                          item.id === rule.id ? { ...item, enabled: !item.enabled } : item
                        ),
                      })
                    }
                    className={`relative h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${rule.enabled ? "bg-cyan-500" : "bg-zinc-700"}`}
                    title={rule.enabled ? "Desactivar regla" : "Activar regla"}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${rule.enabled ? "translate-x-[18px]" : "translate-x-0.5"}`}
                    />
                  </button>
                  <div className={`min-w-0 flex-1 ${rule.enabled ? "" : "opacity-45"}`}>
                    <p className="break-words text-sm text-zinc-200">
                      <span className="font-medium">{rule.source}</span>
                      <span className="mx-2 text-zinc-600">→</span>
                      <span className="text-cyan-300">{rule.replacement}</span>
                    </p>
                  </div>
                  <Btn size="sm" variant="ghost" onClick={() => editRule(rule)}>
                    Editar
                  </Btn>
                  <Btn size="sm" variant="danger" onClick={() => removeRule(rule)}>
                    Eliminar
                  </Btn>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
