"use client";

import { useId } from "react";
import {
  CUSTOM_FIELD_LIMITS,
  type CustomField,
  type CustomFieldType,
} from "@/lib/custom-fields";

function CustomFieldRow({
  field,
  issues,
  onUpdate,
  onRemove,
}: {
  field: CustomField;
  issues: string[];
  onUpdate: (patch: Partial<CustomField>) => void;
  onRemove: () => void;
}) {
  const nameId = useId();
  const typeId = useId();
  const descId = useId();
  const errorId = useId();
  const hasIssues = issues.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[120px]">
          <label htmlFor={nameId} className="block text-xs font-medium text-foreground/70">
            Name
          </label>
          <input
            id={nameId}
            type="text"
            value={field.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            maxLength={CUSTOM_FIELD_LIMITS.nameMax}
            placeholder="Cost Center"
            className="mt-1 w-full border border-rule-warm bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy"
          />
        </div>
        <div className="w-28">
          <label htmlFor={typeId} className="block text-xs font-medium text-foreground/70">
            Type
          </label>
          <select
            id={typeId}
            value={field.type}
            onChange={(e) =>
              onUpdate({ type: e.target.value as CustomFieldType })
            }
            className="mt-1 w-full border border-rule-warm bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy"
          >
            <option value="string">text</option>
            <option value="number">number</option>
            <option value="date">date</option>
          </select>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove field ${field.name || "(unnamed)"}`}
          className="border border-rule-warm bg-background px-2 py-1 text-xs hover:border-red-300 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2 dark:hover:bg-red-950/30 dark:hover:text-red-300"
        >
          Remove
        </button>
      </div>
      <div>
        <label htmlFor={descId} className="block text-xs font-medium text-foreground/70">
          Description (told to Claude)
        </label>
        <textarea
          id={descId}
          value={field.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          maxLength={CUSTOM_FIELD_LIMITS.descriptionMax}
          rows={2}
          placeholder="Extract the GL cost center code. Usually 4 digits, sometimes prefixed with 'CC-'."
          aria-invalid={hasIssues ? true : undefined}
          aria-describedby={hasIssues ? errorId : undefined}
          className="mt-1 w-full border border-rule-warm bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy"
        />
      </div>
      {hasIssues && (
        <p id={errorId} className="text-xs text-amber-700 dark:text-amber-400">
          {issues.join("; ")}
        </p>
      )}
    </div>
  );
}

interface CustomFieldsManagerProps {
  fields: CustomField[];
  onChange: (next: CustomField[]) => void;
}

export function CustomFieldsManager({ fields, onChange }: CustomFieldsManagerProps) {
  const summaryId = useId();
  const atLimit = fields.length >= CUSTOM_FIELD_LIMITS.maxFields;

  const addField = () => {
    if (atLimit) return;
    onChange([
      ...fields,
      {
        id: crypto.randomUUID(),
        name: "",
        type: "string",
        description: "",
      },
    ]);
  };

  const updateField = (id: string, patch: Partial<CustomField>) => {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeField = (id: string) => {
    onChange(fields.filter((f) => f.id !== id));
  };

  const validateField = (f: CustomField) => {
    const issues: string[] = [];
    const trimmedName = f.name.trim();
    const trimmedDesc = f.description.trim();
    if (trimmedName.length < CUSTOM_FIELD_LIMITS.nameMin) {
      issues.push("name required");
    } else if (trimmedName.length > CUSTOM_FIELD_LIMITS.nameMax) {
      issues.push(`name ≤ ${CUSTOM_FIELD_LIMITS.nameMax} chars`);
    }
    if (trimmedDesc.length < CUSTOM_FIELD_LIMITS.descriptionMin) {
      issues.push(
        `description ≥ ${CUSTOM_FIELD_LIMITS.descriptionMin} chars`,
      );
    } else if (trimmedDesc.length > CUSTOM_FIELD_LIMITS.descriptionMax) {
      issues.push(
        `description ≤ ${CUSTOM_FIELD_LIMITS.descriptionMax} chars`,
      );
    }
    return issues;
  };

  return (
    <details className="mt-4 border border-rule-warm">
      <summary
        id={summaryId}
        className="cursor-pointer select-none px-6 py-4 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2"
      >
        Custom fields{" "}
        <span className="text-foreground/50">
          ({fields.length}
          {fields.length > 0 ? ` defined` : ", add fields beyond the standard 9"}
          )
        </span>
      </summary>
      <div className="border-t border-rule-warm px-6 py-4">
        <p className="mb-3 text-xs text-foreground/60">
          Tell Claude to extract additional fields beyond the standard nine
          (cost center, GL code, project number, anything domain-specific).
          Definitions are stored in your browser only and sent with each
          extraction request. Up to {CUSTOM_FIELD_LIMITS.maxFields} fields.
        </p>

        {fields.length === 0 && (
          <p className="mb-3 text-xs italic text-foreground/50">
            No custom fields yet.
          </p>
        )}

        <ul className="space-y-3">
          {fields.map((f) => {
            const issues = validateField(f);
            return (
              <li key={f.id} className="border border-rule-warm bg-ink-navy/[0.03] p-3">
                <CustomFieldRow
                  field={f}
                  issues={issues}
                  onUpdate={(patch) => updateField(f.id, patch)}
                  onRemove={() => removeField(f.id)}
                />
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={addField}
          disabled={atLimit}
          className="mt-3 border border-ink-navy px-3 py-1.5 text-sm font-medium text-ink-navy hover:bg-ink-navy/[0.06] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-navy focus-visible:ring-offset-2"
          aria-label={
            atLimit
              ? `Maximum ${CUSTOM_FIELD_LIMITS.maxFields} custom fields reached`
              : "Add a custom field"
          }
        >
          + Add field
        </button>
      </div>
    </details>
  );
}
