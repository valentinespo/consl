"use client";

import { Fragment, useState } from "react";
import { Plus, ChevronRight } from "lucide-react";
import { qty, date } from "@/lib/format";
import { useMoney } from "@/components/CurrencyProvider";
import { Card, FacilityTag, SkuAvatar, SupplierAvatar } from "@/components/ui";
import { PurchaseInvoiceForm, type PurchaseInvoiceRow, type PurchaseOptions, type PurchaseMaterial } from "@/components/PurchaseInvoiceForm";
import { DocumentList } from "@/components/DocumentList";
import { Paperclip } from "lucide-react";

type Group = {
  material: PurchaseMaterial & { code: string; imageUrl: string | null };
  totalQty: number;
  totalSpend: number;
  invoices: PurchaseInvoiceRow[];
};

const LIMIT = 3;

export function MaterialPurchaseInvoices({ group, options }: { group: Group; options: PurchaseOptions }) {
  const { money } = useMoney();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const invoices = group.invoices;
  const { material } = group;
  const collapsible = invoices.length > LIMIT;
  const showAll = open || !collapsible || expanded.size > 0 || adding;
  const visible = showAll ? invoices : invoices.slice(0, LIMIT + 1);
  const colSpan = material.skuSpecific ? 6 : 5; // date, supplier, [sku], facility, qty, total

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {material.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={material.imageUrl} alt="" className="h-8 w-8 rounded-lg border border-border object-cover" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-base">📦</span>
          )}
          <h2 className="text-[15px] font-semibold text-ink-soft">{material.name} purchases</h2>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-ink-soft">{invoices.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-muted">
            {qty(group.totalQty)} {material.unitLabel}s · {money(group.totalSpend)} spent
          </span>
          <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white hover:opacity-90">
            <Plus size={15} /> Add purchase
          </button>
        </div>
      </div>

      {adding && (
        <div className="mb-3 rounded-[var(--radius-card)] border border-accent-strong bg-surface p-4">
          <div className="mb-3 text-[13px] font-semibold text-ink-soft">New {material.name.toLowerCase()} purchase</div>
          <PurchaseInvoiceForm material={material} options={options} onDone={() => setAdding(false)} />
        </div>
      )}

      <div className="relative">
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5 font-medium">Supplier</th>
                {material.skuSpecific && <th className="px-3 py-2.5 font-medium">SKUs</th>}
                <th className="px-3 py-2.5 font-medium">Facilities</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-4 py-2.5 text-right font-medium">Invoice total</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((inv) => {
                const isOpen = expanded.has(inv.id);
                return (
                  <Fragment key={inv.id}>
                    <tr onClick={() => toggle(inv.id)} className={`cursor-pointer border-b border-line last:border-0 ${isOpen ? "bg-surface-2" : "hover:bg-surface-2"}`}>
                      <td className="px-4 py-3 whitespace-nowrap text-muted align-middle">
                        <div className="flex items-center gap-1.5">
                          <ChevronRight size={14} className={`text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} />
                          {date(inv.dateISO)}
                        </div>
                        {inv.lines.length > 1 && <div className="ml-[22px] mt-0.5 text-[10.5px] text-muted/70">{inv.lines.length} lines</div>}
                      </td>
                      <td className="px-3 py-3 align-middle"><SupplierAvatar name={inv.supplier} photoUrl={inv.supplierPhotoUrl} /></td>
                      {material.skuSpecific && (
                        <td className="px-3 py-3 align-middle">
                          <div className="flex flex-wrap items-center gap-1">
                            {inv.skus.length === 0 ? <span className="text-muted">—</span> : inv.skus.map((s) => <SkuAvatar key={s.code} code={s.code} size={22} imageUrl={s.imageUrl} />)}
                          </div>
                        </td>
                      )}
                      <td className="px-3 py-3 align-middle">
                        <div className="flex flex-wrap items-center gap-1">
                          {inv.facilities.map((f) => (
                            <FacilityTag key={f} code={f} />
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular align-middle">{qty(inv.totalQty)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular align-middle">
                        {money(inv.invoiceTotal)}
                        {inv.documents.length > 0 && (
                          <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] font-normal text-muted">
                            <Paperclip size={11} /> {inv.documents.length}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-line bg-surface-2">
                        <td colSpan={colSpan} className="px-4 py-4">
                          <div className="mb-3 rounded-lg border border-border bg-surface px-3 py-2.5">
                            <div className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Invoice documents</div>
                            <DocumentList parent="purchase" parentId={inv.id} documents={inv.documents} emptyText="No invoice attached yet." />
                          </div>
                          <PurchaseInvoiceForm material={material} options={options} invoice={inv} onDone={() => toggle(inv.id)} cancelLabel="Collapse" />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="px-4 py-8 text-center text-[13px] text-muted">
                    No {material.name.toLowerCase()} purchases yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        {collapsible && !showAll && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-24 items-end justify-center rounded-b-[var(--radius-card)] bg-gradient-to-t from-surface via-surface/95 to-transparent pb-3">
            <button onClick={() => setOpen(true)} className="pointer-events-auto rounded-lg border border-border bg-surface px-4 py-1.5 text-[12.5px] font-medium text-ink-soft shadow-sm hover:bg-surface-2">
              View more ({invoices.length - LIMIT} more)
            </button>
          </div>
        )}
      </div>

      {collapsible && open && (
        <button onClick={() => setOpen(false)} className="mt-2 text-[12.5px] font-medium text-muted hover:text-ink-soft">
          Show less
        </button>
      )}
    </section>
  );
}
