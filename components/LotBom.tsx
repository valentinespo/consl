"use client";

import { X, Undo2 } from "@/components/icons";
import { SkuAvatar } from "@/components/ui";
import { plural } from "@/lib/format";
import { useMoney } from "@/components/CurrencyProvider";

export type MaterialType = { id: string; code: string; name: string; unitLabel: string };
export type Mat = { materialTypeId: string; perUnit: number };
export type BomLine = { key: string; sku: string; productName: string; imageUrl: string | null; units: number };

/**
 * Controlled bill-of-materials editor: a shared "default" rate applied to all SKUs, plus
 * optional per-SKU overrides. State lives in the parent so it saves with the rest of the lot.
 */
export function LotBom({
  lines,
  materialTypes,
  shared,
  overrides,
  onSharedChange,
  onOverridesChange,
}: {
  lines: BomLine[];
  materialTypes: MaterialType[];
  shared: Mat[];
  overrides: Record<string, Mat[]>;
  onSharedChange: (m: Mat[]) => void;
  onOverridesChange: (o: Record<string, Mat[]>) => void;
}) {
  const { qty } = useMoney();
  const mt = (id: string) => materialTypes.find((m) => m.id === id);
  const lineByKey = (k: string) => lines.find((l) => l.key === k);
  const overriddenKeys = Object.keys(overrides).filter((k) => lineByKey(k));
  const sharedLines = lines.filter((l) => !overrides[l.key]);

  function editMats(target: "shared" | string, fn: (m: Mat[]) => Mat[]) {
    if (target === "shared") onSharedChange(fn(shared));
    else onOverridesChange({ ...overrides, [target]: fn(overrides[target] ?? []) });
  }
  const setRate = (t: "shared" | string, i: number, v: number) => editMats(t, (m) => m.map((x, j) => (j === i ? { ...x, perUnit: v } : x)));
  const removeMat = (t: "shared" | string, i: number) => editMats(t, (m) => m.filter((_, j) => j !== i));
  const addMat = (t: "shared" | string, typeId: string) => {
    // Starts at ×1 — the real rate is typed here and inherited by the SKU's future lots.
    if (mt(typeId)) editMats(t, (m) => [...m, { materialTypeId: typeId, perUnit: 1 }]);
  };
  const startOverride = (key: string) => onOverridesChange({ ...overrides, [key]: shared.map((m) => ({ ...m })) });
  const revertOverride = (key: string) => {
    const n = { ...overrides };
    delete n[key];
    onOverridesChange(n);
  };
  const availableToOverride = lines.filter((l) => !overrides[l.key]);

  return (
    <div>
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold text-ink-soft">Bill of materials</h2>
        <p className="text-[12px] text-muted">Raw materials consumed per finished unit — drives the FIFO costs above.</p>
      </div>

      <MatCard
        title="Default rate"
        subtitle={
          overriddenKeys.length === 0
            ? `Applies to all ${lines.length} SKUs in this lot`
            : `Applies to ${sharedLines.length} SKU${sharedLines.length === 1 ? "" : "s"}: ${sharedLines.map((l) => l.sku).join(", ")}`
        }
        avatar={
          <div className="flex -space-x-1.5">
            {sharedLines.slice(0, 5).map((l) => (
              <SkuAvatar key={l.key} code={l.sku} size={26} imageUrl={l.imageUrl} />
            ))}
          </div>
        }
        materials={shared}
        materialTypes={materialTypes}
        onRate={(i, v) => setRate("shared", i, v)}
        onRemove={(i) => removeMat("shared", i)}
        onAdd={(id) => addMat("shared", id)}
      />

      {overriddenKeys.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {overriddenKeys.map((key) => {
            const line = lineByKey(key)!;
            return (
              <MatCard
                key={key}
                title={line.sku}
                subtitle={`${qty(line.units)} units · overrides default`}
                avatar={<SkuAvatar code={line.sku} size={28} imageUrl={line.imageUrl} />}
                action={
                  <button onClick={() => revertOverride(key)} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-muted hover:text-ink-soft">
                    <Undo2 size={12} /> Revert to default
                  </button>
                }
                materials={overrides[key]}
                materialTypes={materialTypes}
                onRate={(i, v) => setRate(key, i, v)}
                onRemove={(i) => removeMat(key, i)}
                onAdd={(id) => addMat(key, id)}
              />
            );
          })}
        </div>
      )}

      {availableToOverride.length > 0 && (
        <div className="mt-3">
          <select
            value=""
            onChange={(e) => e.target.value && startOverride(e.target.value)}
            className="h-9 rounded-lg border border-dashed border-border bg-surface px-3 text-[12.5px] text-muted outline-none focus:border-accent-strong"
          >
            <option value="">+ Override a specific SKU…</option>
            {availableToOverride.map((l) => (
              <option key={l.key} value={l.key}>
                {l.sku} — {l.productName}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function MatCard({
  title,
  subtitle,
  avatar,
  action,
  materials,
  materialTypes,
  onRate,
  onRemove,
  onAdd,
}: {
  title: string;
  subtitle: string;
  avatar: React.ReactNode;
  action?: React.ReactNode;
  materials: Mat[];
  materialTypes: MaterialType[];
  onRate: (i: number, v: number) => void;
  onRemove: (i: number) => void;
  onAdd: (typeId: string) => void;
}) {
  const mt = (id: string) => materialTypes.find((m) => m.id === id);
  const available = materialTypes.filter((m) => !materials.some((x) => x.materialTypeId === m.id));
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-3">
        {avatar}
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-ink">{title}</div>
          <div className="text-[11px] text-muted">{subtitle}</div>
        </div>
        {action}
      </div>
      <div className="space-y-2">
        {materials.map((m, i) => {
          const type = mt(m.materialTypeId);
          return (
            <div key={m.materialTypeId} className="flex items-center gap-2">
              <span className="flex-1 text-[13px] text-ink-soft">{type?.name ?? "Material"}</span>
              <input
                type="number"
                step="any"
                min="0"
                value={m.perUnit}
                onChange={(e) => onRate(i, Number(e.target.value))}
                className="h-8 w-20 rounded-lg border border-border bg-surface-2 px-2 text-right text-[13px] tabular text-ink outline-none focus:border-accent-strong"
              />
              <span className="w-24 text-[11.5px] text-muted">
                {(m.perUnit === 1 ? (type?.unitLabel ?? "unit") : plural(type?.unitLabel ?? "unit")) + " / unit"}
              </span>
              <button onClick={() => onRemove(i)} className="text-muted hover:text-negative" title="Remove">
                <X size={15} />
              </button>
            </div>
          );
        })}
        {materials.length === 0 && <p className="text-[12px] text-muted">No materials assigned.</p>}
      </div>
      {available.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <select
            value=""
            onChange={(e) => e.target.value && onAdd(e.target.value)}
            className="h-8 w-full rounded-lg border border-dashed border-border bg-surface px-2 text-[12.5px] text-muted outline-none focus:border-accent-strong"
          >
            <option value="">+ Add material…</option>
            {available.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} (in {plural(m.unitLabel)})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
