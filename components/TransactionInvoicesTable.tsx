"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, ArrowUpDown, ChevronRight } from "@/components/icons";
import { ExpandRow } from "@/components/animate";
import { DatePicker } from "@/components/DatePicker";
import { SupplierAvatar, SkuAvatar } from "@/components/ui";
import { useMoney } from "@/components/CurrencyProvider";
import { TransactionInvoiceForm, type InvoiceRow, type LotOption } from "@/components/TransactionInvoiceForm";
import { Paperclip } from "@/components/icons";
import { useCan } from "@/components/AccessProvider";

type SortKey = "date" | "applicable";

// Stored keys are legacy (TEA/OTHER); the labels are business-neutral.
// Legacy keys map to friendly labels for any un-migrated rows; new categories are shown verbatim.
const CAT_LABEL: Record<string, string> = { TEA: "Ingredients", OTHER: "Production", NOT_APPLICABLE: "Not applicable" };
const catLabel = (c: string) => CAT_LABEL[c] ?? c;

export function TransactionInvoicesTable({
  invoices,
  lots,
  suppliers,
  categories = [],
  skuImages,
  showLotColumn = true,
  defaultLotId,
  openEstimateLots = [],
}: {
  invoices: InvoiceRow[];
  lots: LotOption[];
  suppliers: string[];
  categories?: string[];
  skuImages?: Record<string, string | null>;
  showLotColumn?: boolean;
  defaultLotId?: string;
  openEstimateLots?: { lotId: string; lotNr: number; invoiceId: string }[];
}) {
  const { money, date } = useMoney();
  const canCreate = useCan("transactions", "create");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("ALL");
  // Filter offers every category actually present in the data.
  const presentCategories = useMemo(
    () => [...new Set([...categories, ...invoices.flatMap((inv) => inv.lines.map((l) => l.category))])].filter(Boolean),
    [categories, invoices],
  );
  const [lot, setLot] = useState("ALL");
  const [supplier, setSupplier] = useState("ALL");
  const [payment, setPayment] = useState("ALL"); // ALL | unpaid | partial | overdue | paid | est
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const colSpan = showLotColumn ? 7 : 6;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = invoices.filter((inv) => {
      if (category !== "ALL" && !inv.lines.some((l) => l.category === category)) return false;
      if (lot === "UNASSIGNED" && !inv.hasUnassigned) return false;
      if (lot !== "ALL" && lot !== "UNASSIGNED" && !inv.lines.some((l) => String(l.lotNr) === lot)) return false;
      if (supplier !== "ALL" && (inv.supplier ?? "") !== supplier) return false;
      if (payment === "est" && !inv.isEstimate) return false;
      if (payment !== "ALL" && payment !== "est" && inv.paymentStatus !== payment) return false;
      if (from && (!inv.dateISO || inv.dateISO < from)) return false;
      if (to && (!inv.dateISO || inv.dateISO > to)) return false;
      if (needle) {
        const hay = `${inv.supplier ?? ""} ${inv.presentSkus.join(" ")} ${inv.presentLots.map((l) => l.lotNr).join(" ")} ${inv.lines
          .map((l) => l.concept ?? "")
          .join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      const cmp = sortKey === "date" ? (a.dateISO ?? "").localeCompare(b.dateISO ?? "") : a.applicable - b.applicable;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [invoices, q, category, lot, supplier, payment, from, to, sortKey, sortDir]);

  const applicableTotal = filtered.reduce((s, inv) => s + inv.applicable, 0);
  const naTotal = filtered.reduce((s, inv) => s + inv.notApplicable, 0);
  const unassignedTotal = filtered.reduce((s, inv) => s + inv.unassignedAmount, 0);
  const anyFilter = q || category !== "ALL" || lot !== "ALL" || supplier !== "ALL" || from || to;

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search supplier, SKU, lot, concept…"
          className="h-9 min-w-[220px] flex-1 rounded-lg border border-border bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-muted focus:border-accent-strong"
        />
        <Select value={category} onChange={setCategory} options={["ALL", ...presentCategories]} label={(v) => (v === "ALL" ? "All categories" : catLabel(v))} />
        {showLotColumn && (
          <Select
            value={lot}
            onChange={setLot}
            options={["ALL", "UNASSIGNED", ...lots.map((l) => String(l.lotNr))]}
            label={(v) => (v === "ALL" ? "All lots" : v === "UNASSIGNED" ? "⚠ Unassigned" : `Lot #${v}`)}
          />
        )}
        <Select value={supplier} onChange={setSupplier} options={["ALL", ...suppliers]} label={(v) => (v === "ALL" ? "All suppliers" : v)} />
        <Select
          value={payment}
          onChange={setPayment}
          options={["ALL", "unpaid", "partial", "overdue", "paid", "est"]}
          label={(v) =>
            v === "ALL" ? "All payments" : v === "est" ? "Estimates" : v === "unpaid" ? "Unpaid" : v === "partial" ? "Partially paid" : v === "overdue" ? "Overdue" : "Paid"
          }
        />
        <DateInput value={from} onChange={setFrom} placeholder="From" />
        <DateInput value={to} onChange={setTo} placeholder="To" />
        {anyFilter && (
          <button
            onClick={() => {
              setQ("");
              setCategory("ALL");
              setLot("ALL");
              setSupplier("ALL");
              setFrom("");
              setTo("");
            }}
            className="text-[12.5px] font-medium text-muted hover:text-ink-soft"
          >
            Clear
          </button>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[12.5px]">
        <span className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 font-medium text-ink">
          COG-applicable total: {money(applicableTotal, 2)}
          {unassignedTotal > 0.005 && <span className="ml-1.5 font-normal text-negative">({money(unassignedTotal, 2)} unassigned)</span>}
        </span>
        {naTotal > 0 && <span className="text-muted">Not applicable: {money(naTotal, 2)}</span>}
        <span className="text-muted">
          {filtered.length} of {invoices.length} invoices
        </span>
        {canCreate && (
          <button
            onClick={() => setAdding((v) => !v)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-[12.5px] font-medium text-bg hover:opacity-90"
          >
            <Plus size={15} /> Add transaction
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3 rounded-[var(--radius-card)] border border-accent-strong bg-surface p-4">
          <div className="mb-3 text-[13px] font-semibold text-ink-soft">New transaction</div>
          <TransactionInvoiceForm lots={lots} suppliers={suppliers} categories={categories} skuImages={skuImages} defaultLotId={defaultLotId} openEstimateLots={openEstimateLots} onDone={() => setAdding(false)} />
        </div>
      )}

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <SortTh label="Date" onClick={() => toggleSort("date")} active={sortKey === "date"} dir={sortDir} className="px-4" />
              {showLotColumn && <th className="px-3 py-2.5 font-medium">Lot</th>}
              <th className="px-3 py-2.5 font-medium">Supplier</th>
              <th className="px-3 py-2.5 font-medium">SKU</th>
              <th className="px-3 py-2.5 font-medium">Cat.</th>
              <SortTh label="Applicable" onClick={() => toggleSort("applicable")} active={sortKey === "applicable"} dir={sortDir} className="px-4 text-right" right />
              <th className="px-4 py-2.5 text-right font-medium">Invoice</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inv) => {
              const open = expanded.has(inv.id);
              return (
                <Fragment key={inv.id}>
                  <tr onClick={() => toggle(inv.id)} className={`cursor-pointer border-b border-line last:border-0 ${open ? "bg-surface-2" : "hover:bg-surface-2"}`}>
                    <td className="px-4 py-3 whitespace-nowrap text-muted align-middle">
                      <div className="flex items-center gap-1.5">
                        <ChevronRight size={14} className={`text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                        {date(inv.dateISO)}
                      </div>
                      {inv.lines.length > 1 && <div className="ml-[22px] mt-0.5 text-[10.5px] text-muted/70">{inv.lines.length} lines</div>}
                    </td>
                    {showLotColumn && (
                      <td className="px-3 py-3 align-middle">
                        <div className="flex flex-wrap items-center gap-1">
                          {inv.presentLots.map((l) => (
                            <Link
                              key={l.lotNr}
                              href={`/lots/${l.lotId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-ink hover:underline"
                            >
                              #{l.lotNr}
                            </Link>
                          ))}
                          {inv.hasUnassigned && (
                            <span className="rounded-md bg-[#fbeae6] px-1.5 py-0.5 text-[11px] font-semibold text-negative">⚠ Unassigned</span>
                          )}
                          {inv.presentLots.length === 0 && !inv.hasUnassigned && <span className="text-muted">—</span>}
                        </div>
                      </td>
                    )}
                    <td className="px-3 py-3 align-middle"><SupplierAvatar name={inv.supplier} photoUrl={inv.supplierPhotoUrl} /></td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-wrap items-center gap-1">
                        {inv.presentSkus.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          inv.presentSkus.map((s) =>
                            s.missing ? (
                              <span
                                key={s.code}
                                className="inline-flex items-center gap-1 rounded-md bg-[#fbeae6] px-1.5 py-0.5 text-[11px] font-semibold text-negative"
                                title={`SKU ${s.code} was removed from its lot — reassign this allocation`}
                              >
                                ⚠ {s.code}
                              </span>
                            ) : (
                              <SkuAvatar key={s.code} code={s.code} size={22} imageUrl={s.imageUrl} />
                            ),
                          )
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-wrap items-center gap-1">
                        {inv.presentCats.map((c) => (
                          <span key={c} className="inline-flex items-center rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-soft">{catLabel(c)}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right align-middle">
                      <div className="text-[15px] font-semibold tabular text-ink">{money(inv.applicable, 2)}</div>
                    </td>
                    <td className="px-4 py-3 text-right align-middle">
                      <div className="text-[12px] tabular text-muted">{money(inv.invoiceTotal, 2)}</div>
                      {(inv.isEstimate || inv.paymentStatus) && (
                        <div className="mt-0.5 flex items-center justify-end gap-1">
                          {inv.isEstimate && (
                            <span className="pill-amber inline-flex items-center rounded-full px-1.5 py-[2px] text-[10px] font-medium leading-none">est.</span>
                          )}
                          {inv.paymentStatus === "overdue" && (
                            <span className="pill-red inline-flex items-center rounded-full px-1.5 py-[2px] text-[10px] font-medium leading-none">overdue</span>
                          )}
                          {inv.paymentStatus === "unpaid" && (
                            <span className="pill-neutral inline-flex items-center rounded-full px-1.5 py-[2px] text-[10px] font-medium leading-none">unpaid</span>
                          )}
                          {inv.paymentStatus === "partial" && (
                            <span className="pill-amber inline-flex items-center rounded-full px-1.5 py-[2px] text-[10px] font-medium leading-none">partial</span>
                          )}
                          {inv.paymentStatus === "paid" && (
                            <span className="pill-green inline-flex items-center rounded-full px-1.5 py-[2px] text-[10px] font-medium leading-none">paid</span>
                          )}
                        </div>
                      )}
                      {inv.notApplicable > 0 && (
                        <div className="text-[11px] tabular text-negative/70">N/A {money(inv.notApplicable, 2)}</div>
                      )}
                      {inv.documents.length > 0 && (
                        <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted">
                          <Paperclip size={11} /> {inv.documents.length}
                        </div>
                      )}
                    </td>
                  </tr>
                  <ExpandRow open={open} className="border-b border-line bg-surface-2">
                      <td colSpan={colSpan} className="px-4 py-4">
                        <TransactionInvoiceForm
                          invoice={inv}
                          documents={inv.documents}
                          openEstimateLots={openEstimateLots}
                          lots={lots}
                          suppliers={suppliers}
                          categories={categories}
                          skuImages={skuImages}
                          defaultLotId={defaultLotId}
                          onDone={() => toggle(inv.id)}
                          cancelLabel="Collapse"
                        />
                      </td>
                  </ExpandRow>
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center text-[13px] text-muted">
                  {invoices.length === 0 ? "No transactions yet." : "No transactions match your filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Select({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: string[]; label: (v: string) => string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 max-w-[160px] rounded-lg border border-border bg-surface px-2.5 text-[13px] text-ink-soft outline-none focus:border-accent-strong"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {label(o)}
        </option>
      ))}
    </select>
  );
}

function DateInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <DatePicker value={value} onChange={onChange} placeholder={placeholder} clearable fullWidth={false} className="w-[150px]" />;
}

function SortTh({ label, onClick, active, dir, className = "", right = false }: { label: string; onClick: () => void; active: boolean; dir: "asc" | "desc"; className?: string; right?: boolean }) {
  return (
    <th className={`py-2.5 font-medium ${className}`}>
      <button onClick={onClick} className={`inline-flex items-center gap-1 hover:text-ink-soft ${right ? "flex-row-reverse" : ""} ${active ? "text-ink-soft" : ""}`}>
        {label}
        <ArrowUpDown size={12} className={active ? "opacity-100" : "opacity-40"} />
        {active && <span className="text-[9px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}
