"use client";

import { useState } from "react";
import { MapTrifold, X } from "@/components/icons";
import { FacilityMappingClient, PlaceDialog, type MappingData, type Place } from "@/components/FacilityMappingClient";

/**
 * "Map your places" on the setup wizard's facilities step: the same rows as Facilities → Map
 * facilities in a pop-up, and the "What is this place?" form takes the pop-up's place while a
 * place is being changed (one pop-up, never two stacked).
 */
export function MapPlacesPopup({ data }: { data: MappingData }) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The list re-renders with fresh data after every save; the form must see that same fresh place.
  const editing: Place | null = editingId ? (data.channelPlaces.find((p) => p.id === editingId) ?? null) : null;
  const close = () => {
    setOpen(false);
    setEditingId(null);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-3 text-[12.5px] font-medium text-ink-soft hover:text-ink"
      >
        <MapTrifold size={14} /> Map your places
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={close}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Your places"
            className="org-pop max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {editing ? (
              <PlaceDialog inline place={editing} candidates={data.candidates} fbaName={data.fbaName} onClose={() => setEditingId(null)} />
            ) : (
              <>
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-[16px] font-semibold text-ink">Your places</div>
                    <p className="mt-1 max-w-[560px] text-[12.5px] leading-relaxed text-muted">
                      Every place your channels ship from, and what consl does with it. Change a place if it is really one of your
                      other facilities, Amazon&apos;s fulfilment, or nothing consl should count — your starting stock follows these
                      choices.
                    </p>
                  </div>
                  <button type="button" onClick={close} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
                    <X size={16} />
                  </button>
                </div>
                <FacilityMappingClient data={data} onEdit={(p) => setEditingId(p.id)} />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
