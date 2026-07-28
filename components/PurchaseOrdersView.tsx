"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ChevronRight, FileText } from "@/components/icons";
import { Pill, SkuAvatar } from "@/components/ui";
import { useMoney } from "@/components/CurrencyProvider";
import { PoForm, type PoFacility, type PoProduct, type PoRow } from "@/components/PoForm";
import { setPoStatus, deletePurchaseOrder } from "@/app/purchase-orders/actions";
import { useRouter } from "next/navigation";
import { TwoStepDelete } from "@/components/TwoStepDelete";
import { useCan } from "@/components/AccessProvider";

export type PoListRow = Omit<PoRow, "lines"> & {
  status: string;
  vendor: string;
  facilityCode: string;
  lotId: string | null;
  total: number | null;
  pdfUrl: string | null;
  imported: boolean;
  lines: (PoRow["lines"][number] & { sku: string | null; skuImageUrl: string | null })[];
};

export function PurchaseOrdersView({
  pos,
  facilities,
  products,
  descSeeds,
  nextLotNr,
  todayISO,
}: {
  pos: PoListRow[];
  facilities: PoFacility[];
  products: PoProduct[];
  descSeeds: Record<string, string>;
  nextLotNr: number;
  todayISO: string;
}) {
  const { money, date } = useMoney();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const router = useRouter();
  const canCreate = useCan("purchaseOrders", "create");
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div>
      {/* Create form, then every PO underneath it — no sub-tabs to hunt through. Hidden for members
          who can't create POs; they still see the list below (read-only). */}
      {canCreate && (
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <PoForm facilities={facilities} products={products} descSeeds={descSeeds} nextLotNr={nextLotNr} todayISO={todayISO} onDone={() => router.refresh()} />
        </div>
      )}

      <div className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <FileText size={15} className="text-muted" />
          <h2 className="text-[15px] font-medium text-ink-soft">All purchase orders</h2>
          <span className="tabular text-[12px] text-muted">({pos.length})</span>
        </div>
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">PO #</th>
                <th className="px-3 py-2.5 font-medium">Vendor</th>
                <th className="px-3 py-2.5 font-medium">Lot</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 text-right font-medium">PDF</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((po) => {
                const open = expanded.has(po.id);
                return (
                  <Fragment key={po.id}>
                    <tr onClick={() => toggle(po.id)} className={`cursor-pointer border-b border-line last:border-0 ${open ? "bg-surface-2" : "hover:bg-surface-2"}`}>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        <div className="flex items-center gap-1.5">
                          <ChevronRight size={14} className={`text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                          {date(po.dateISO)}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-semibold tabular text-ink">{po.number}</td>
                      <td className="px-3 py-3">{po.vendor}</td>
                      <td className="px-3 py-3">
                        {po.lotId ? (
                          <Link href={`/lots/${po.lotId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:underline">
                            #{po.lotNr}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-medium tabular">
                        {po.total == null ? <span className="text-muted">{po.lines.length > 0 ? "TBD" : "—"}</span> : money(po.total, 2)}
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <StatusSelect id={po.id} status={po.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {po.pdfUrl ? (
                          <a href={po.pdfUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
                            <FileText size={13} /> View
                          </a>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-line bg-surface-2">
                        <td colSpan={7} className="px-4 py-4">
                          {po.imported ? (
                            <ImportedPo po={po} />
                          ) : po.status === "SENT" ? (
                            <SentPo po={po} />
                          ) : (
                            <PoForm facilities={facilities} products={products} descSeeds={descSeeds} nextLotNr={nextLotNr} po={po} todayISO={todayISO} onDone={() => toggle(po.id)} />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {pos.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-muted">
                    No purchase orders yet — create the first one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Historical PO imported from Drive: PDF + metadata only, no editable lines. */
function ImportedPo({ po }: { po: PoListRow }) {
  const [delStep, setDelStep] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  async function remove() {
    setPending(true);
    try {
      const res = await deletePurchaseOrder(po.id);
      if (!res.ok) {
        setError(res.error);
        setDelStep(0);
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server — reload to check whether it was deleted.");
      setDelStep(0);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-3">
      {po.lines.length > 0 && <PoLinesList po={po} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-muted">
          Imported from the Drive archive — the original PDF is attached.
          {po.lotId && (
            <>
              {" "}
              Linked to{" "}
              <Link href={`/lots/${po.lotId}`} className="font-medium text-ink hover:underline">
                Lot #{po.lotNr}
              </Link>
              .
            </>
          )}
        </p>
        {po.status === "SENT" ? (
          <span className="text-[12px] text-muted">🔒 Sent — switch to Draft to delete.</span>
        ) : (
          <div className="flex items-center gap-3">
            {error && <span className="text-[12px] text-negative">{error}</span>}
            <TwoStepDelete step={delStep} setStep={setDelStep} pending={pending} onConfirm={remove} noun="purchase order" />
          </div>
        )}
      </div>
    </div>
  );
}

/** Read-only list of a PO's lines. */
function PoLinesList({ po }: { po: PoListRow }) {
  const { money, qty } = useMoney();
  return (
    <div className="space-y-1.5">
      {po.lines.map((l, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 text-[12.5px]">
          {l.sku ? <SkuAvatar code={l.sku} imageUrl={l.skuImageUrl} size={22} /> : <span className="rounded-md border border-border px-1.5 py-0.5 text-[10.5px] text-muted">FEE</span>}
          <span className="text-ink-soft">{l.description}</span>
          <span className="ml-auto tabular text-muted">
            {l.unitCost == null ? "TBD" : money(l.unitCost, 2)} × {qty(l.quantity)} ={" "}
            <span className="font-medium text-ink">{l.unitCost == null ? "TBD" : money(l.unitCost * l.quantity, 2)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function StatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function change(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value === "SENT" ? "SENT" : "DRAFT";
    setPending(true);
    try {
      await setPoStatus(id, next);
      router.refresh();
    } finally {
      setPending(false); // always recover the control, even if the action rejects after saving
    }
  }
  return (
    <select
      value={status}
      onChange={change}
      disabled={pending}
      className={`h-7 rounded-full border px-2 text-[11.5px] font-medium outline-none disabled:opacity-50 ${
        status === "SENT" ? "border-[#bbf7d0] bg-[#dcfce7] text-[#166534]" : "border-border bg-[#f5f5f5] text-muted"
      }`}
    >
      <option value="DRAFT">Draft</option>
      <option value="SENT">Sent</option>
    </select>
  );
}

/** A SENT PO is locked — read-only summary until it's switched back to Draft. */
function SentPo({ po }: { po: PoListRow }) {
  return (
    <div className="space-y-3">
      <PoLinesList po={po} />
      <p className="text-[12px] text-muted">🔒 This PO is marked as Sent and locked. Switch its status to Draft to edit or delete it.</p>
    </div>
  );
}

