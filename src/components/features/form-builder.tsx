"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, Loader2, Plus, Rocket, Trash2 } from "lucide-react";
import { Alert, Badge, Button, Card, EmptyState, type Tone } from "@/components/ui";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/form";
import { apiRequest } from "./api-client";
import type { Dictionary } from "@/i18n/dictionaries";

/**
 * M5 admin builder: create/edit a draft version of a dynamic form, preview it live and
 * publish it. A published version is immutable — the UI says so and the server enforces it.
 * Field ordering, required flags and validation rules all come from the same payload the
 * server validates, so the preview shows exactly what a student will get.
 */

export interface FormFieldView {
  id?: number;
  fieldKey: string;
  labelFa: string;
  fieldType: string;
  isRequired: boolean;
  orderIndex: number;
  placeholderFa?: string | null;
  helpFa?: string | null;
  options?: string[] | null;
  validation?: Record<string, number | string> | null;
  visibleWhen?: { fieldKey: string; equals?: string; notEquals?: string } | null;
  isActive: boolean;
}

export interface FormDefinitionView {
  id: number;
  code: string;
  titleFa: string;
  descriptionFa: string | null;
  version: number;
  isPublished: boolean;
  isActive: boolean;
  stageKey: string | null;
  activeFieldCount?: number;
  fields?: FormFieldView[];
}

const TONE: Record<string, Tone> = { published: "success", draft: "warning" };

function emptyField(dict: Dictionary, index: number): FormFieldView {
  return {
    fieldKey: `field_${index + 1}`,
    labelFa: "",
    fieldType: "text",
    isRequired: false,
    orderIndex: index,
    isActive: true,
    options: null,
    validation: null,
    visibleWhen: null,
  };
}

export function FormBuilder({ dict, initialDefinitions }: { dict: Dictionary; initialDefinitions: FormDefinitionView[] }) {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<FormDefinitionView[]>(initialDefinitions);
  const [selectedId, setSelectedId] = useState<number | null>(initialDefinitions[0]?.id ?? null);
  const [fields, setFields] = useState<FormFieldView[]>([]);
  const [meta, setMeta] = useState({ code: "proposal", titleFa: "", descriptionFa: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selected = definitions.find((d) => d.id === selectedId) ?? null;
  const readOnly = !!selected?.isPublished;

  const loadDefinitions = useCallback(async () => {
    const result = await apiRequest<{ definitions: FormDefinitionView[] }>("/api/admin/forms", "GET");
    if (result.ok) setDefinitions(result.data.definitions);
    else setError(result.message || dict.forms.errorLoading);
  }, [dict.forms.errorLoading]);

  const loadFields = useCallback(
    async (id: number) => {
      const result = await apiRequest<FormDefinitionView>(`/api/admin/forms/${id}`, "GET");
      if (result.ok) {
        setFields((result.data.fields ?? []).map((f, i) => ({ ...f, orderIndex: f.orderIndex ?? i })));
        setMeta({ code: result.data.code, titleFa: result.data.titleFa, descriptionFa: result.data.descriptionFa ?? "" });
        setError(null);
      } else {
        setError(result.message || dict.forms.errorLoading);
      }
    },
    [dict.forms.errorLoading],
  );

  useEffect(() => {
    if (selectedId == null) return;
    let alive = true;
    apiRequest<FormDefinitionView>(`/api/admin/forms/${selectedId}`, "GET").then((result) => {
      if (!alive) return;
      if (result.ok) {
        setFields((result.data.fields ?? []).map((f, i) => ({ ...f, orderIndex: f.orderIndex ?? i })));
        setMeta({ code: result.data.code, titleFa: result.data.titleFa, descriptionFa: result.data.descriptionFa ?? "" });
        setError(null);
      } else {
        setError(result.message || dict.forms.errorLoading);
      }
    });
    return () => {
      alive = false;
    };
  }, [selectedId, dict.forms.errorLoading]);

  const payloadFields = () =>
    fields.map((f, index) => ({
      fieldKey: f.fieldKey,
      labelFa: f.labelFa,
      fieldType: f.fieldType,
      isRequired: f.isRequired,
      orderIndex: index,
      placeholderFa: f.placeholderFa ?? null,
      helpFa: f.helpFa ?? null,
      options: f.options && f.options.length ? f.options : null,
      validation: f.validation ?? null,
      visibleWhen: f.visibleWhen && f.visibleWhen.fieldKey ? f.visibleWhen : null,
      isActive: f.isActive,
    }));

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    [next[index], next[target]] = [next[target], next[index]];
    setFields(next);
  }

  async function createNewForm() {
    if (fields.length === 0) {
      setFields([emptyField(dict, 0)]);
      setSelectedId(null);
      setMeta({ code: meta.code || "proposal", titleFa: "", descriptionFa: "" });
      return;
    }
    setBusy(true);
    setError(null);
    const result = await apiRequest<FormDefinitionView>("/api/admin/forms", "POST", {
      code: meta.code,
      titleFa: meta.titleFa,
      descriptionFa: meta.descriptionFa || null,
      fields: payloadFields(),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setSuccess(dict.forms.saved);
    await loadDefinitions();
    setSelectedId(result.data.id);
    router.refresh();
  }

  async function saveDraftFields() {
    if (selectedId == null) return;
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/admin/forms/${selectedId}`, "PUT", { fields: payloadFields() });
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setSuccess(dict.forms.saved);
    router.refresh();
  }

  async function publish() {
    if (selectedId == null) return;
    setBusy(true);
    setError(null);
    const result = await apiRequest(`/api/admin/forms/${selectedId}/publish`, "POST", {});
    setBusy(false);
    if (!result.ok) {
      setError(result.message || result.code);
      return;
    }
    setSuccess(dict.forms.publishedDone);
    await loadDefinitions();
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <Card className="grid content-start gap-3 p-4">
        <h2 className="text-sm font-semibold">{dict.forms.definitions}</h2>
        {definitions.length === 0 ? (
          <p className="text-sm text-fg-muted">{dict.forms.noDefinitions}</p>
        ) : (
          <ul className="grid gap-2">
            {definitions.map((definition) => (
              <li key={definition.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(definition.id)}
                  aria-current={definition.id === selectedId}
                  className={`flex min-h-11 w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-start text-sm ${
                    definition.id === selectedId ? "border-primary bg-surface-2" : "border-border hover:bg-surface-2"
                  }`}
                >
                  <span className="font-medium">{definition.code}</span>
                  <span className="flex items-center gap-2 text-xs text-fg-muted">
                    <Badge tone={definition.isPublished ? TONE.published : TONE.draft}>
                      {definition.isPublished ? dict.forms.published : dict.forms.draft}
                    </Badge>
                    {`${dict.forms.version} ${definition.version}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="secondary" onClick={() => { setSelectedId(null); setFields([emptyField(dict, 0)]); }}>
          <Plus className="size-4" aria-hidden />
          {dict.forms.newForm}
        </Button>
      </Card>

      <div className="grid content-start gap-6">
        <Card className="grid gap-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{selected ? `${selected.code} — ${dict.forms.version} ${selected.version}` : dict.forms.newForm}</h2>
            {selected ? (
              <div className="flex items-center gap-2">
                <Badge tone={selected.isPublished ? TONE.published : TONE.draft}>{selected.isPublished ? dict.forms.published : dict.forms.draft}</Badge>
                {selected.isPublished ? <span className="text-xs text-fg-muted">{dict.forms.publishedLocked}</span> : null}
              </div>
            ) : null}
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}
          {success ? <Alert tone="success">{success}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={dict.forms.code} dir="ltr" className="text-start" value={meta.code} onChange={(e) => setMeta({ ...meta, code: e.target.value })} disabled={!!selected} />
            <Input label={dict.forms.formTitle} value={meta.titleFa} onChange={(e) => setMeta({ ...meta, titleFa: e.target.value })} disabled={readOnly} />
          </div>
          <Textarea label={dict.topic.description} value={meta.descriptionFa} onChange={(e) => setMeta({ ...meta, descriptionFa: e.target.value })} disabled={readOnly} />

          <div className="grid gap-3">
            {fields.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-fg-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {dict.forms.loading}
              </p>
            ) : (
              fields.map((field, index) => (
                <div key={`${field.fieldKey}-${index}`} className="grid gap-3 rounded-lg border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input label={dict.forms.fieldKey} dir="ltr" className="text-start" value={field.fieldKey} disabled={readOnly} onChange={(e) => {
                      const next = [...fields];
                      next[index] = { ...field, fieldKey: e.target.value };
                      setFields(next);
                    }} />
                    <Input label={dict.forms.fieldLabel} value={field.labelFa} disabled={readOnly} onChange={(e) => {
                      const next = [...fields];
                      next[index] = { ...field, labelFa: e.target.value };
                      setFields(next);
                    }} />
                    <Select label={dict.forms.fieldType} value={field.fieldType} disabled={readOnly} onChange={(e) => {
                      const next = [...fields];
                      next[index] = { ...field, fieldType: e.target.value };
                      setFields(next);
                    }}>
                      {Object.entries(dict.forms.types).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </Select>
                  </div>
                  {field.fieldType === "select" || field.fieldType === "radio" || field.fieldType === "checkbox" ? (
                    <Input
                      label={dict.forms.options}
                      value={(field.options ?? []).join("، ")}
                      disabled={readOnly}
                      onChange={(e) => {
                        const next = [...fields];
                        next[index] = { ...field, options: e.target.value.split(/[،,]/).map((s) => s.trim()).filter(Boolean) };
                        setFields(next);
                      }}
                    />
                  ) : null}
                  <Checkbox
                    label={dict.forms.required}
                    checked={field.isRequired}
                    disabled={readOnly}
                    onChange={(e) => {
                      const next = [...fields];
                      next[index] = { ...field, isRequired: e.target.checked };
                      setFields(next);
                    }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => move(index, -1)} disabled={readOnly || index === 0} aria-label={dict.forms.moveUp}>
                      <ArrowUp className="size-4" aria-hidden />
                    </Button>
                    <Button variant="ghost" onClick={() => move(index, 1)} disabled={readOnly || index === fields.length - 1} aria-label={dict.forms.moveDown}>
                      <ArrowDown className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => setFields(fields.filter((_, i) => i !== index))}
                      disabled={readOnly || fields.length === 1}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      {dict.forms.removeField}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setFields([...fields, emptyField(dict, fields.length)])} disabled={readOnly}>
              <Plus className="size-4" aria-hidden />
              {dict.forms.addField}
            </Button>
            {selectedId == null ? (
              <Button onClick={createNewForm} disabled={busy || !meta.code || !meta.titleFa} aria-busy={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {dict.forms.createVersion}
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={saveDraftFields} disabled={readOnly || busy} aria-busy={busy}>
                  {dict.forms.saveDraft}
                </Button>
                <Button onClick={publish} disabled={readOnly || busy} aria-busy={busy}>
                  <Rocket className="size-4" aria-hidden />
                  {dict.forms.publish}
                </Button>
              </>
            )}
          </div>
        </Card>

        <Card className="grid gap-4 p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Eye className="size-5 text-teal-600" aria-hidden />
            {dict.forms.preview}
          </h2>
          {fields.length === 0 ? (
            <EmptyState title={dict.forms.noDefinitions} />
          ) : (
            <form className="grid gap-4" onSubmit={(e) => e.preventDefault()}>
              {fields.filter((f) => f.isActive).map((field) => (
                <PreviewField key={field.fieldKey} field={field} dict={dict} />
              ))}
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}

function PreviewField({ field, dict }: { field: FormFieldView; dict: Dictionary }) {
  const label = field.labelFa || field.fieldKey;
  const hint = field.helpFa ?? undefined;
  if (field.fieldType === "textarea") {
    return <Textarea label={label} required={field.isRequired} hint={hint} placeholder={field.placeholderFa ?? undefined} />;
  }
  if (field.fieldType === "select" || field.fieldType === "radio") {
    return (
      <Select label={label} hint={hint}>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </Select>
    );
  }
  if (field.fieldType === "checkbox") {
    return <Checkbox label={label} />;
  }
  return <Input label={label} type={field.fieldType === "number" ? "number" : field.fieldType === "date" ? "date" : "text"} required={field.isRequired} hint={hint} placeholder={field.placeholderFa ?? undefined} />;
}
