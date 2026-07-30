"use client";

import { useState } from "react";
import { Donut, type Slice } from "@/components/Donut";

/** The Inventory hero's wheel — the dashboard donut with the bucket palette (raw amber,
 *  production violet, finished green). A thin client wrapper so the server page doesn't have
 *  to own the hover state the donut needs. */
export function InventoryMixDonut({ data, palette }: { data: Slice[]; palette: string[] }) {
  const [hover, setHover] = useState<number | null>(null);
  return <Donut data={data} palette={palette} hover={hover} onHover={setHover} />;
}
