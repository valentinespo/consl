/** Explanations for the restock settings, shared by the Settings page and the inline editor on
 *  Inventory so the two can't drift apart. One or two short lines each — these are hover hints,
 *  not documentation, and nobody reads a paragraph off a tooltip. */

export const FLOOR_HELP = {
  title: "Floor",
  body: "The least cover you want at the sales channel, in months. Drop below it and the product gets flagged to order.",
};

export const LEAD_HELP = {
  title: "Lead time",
  body: "How long a production run takes to make, in months. Making only — moving it to the channel is the shipping time.",
};

export const SHIP_HELP = {
  title: "Shipping time",
  body: "How long it takes to move stock onto the sales channel, in days.",
};

export const BUFFER_HELP = {
  title: "Shipping buffer",
  body: "How early to start shipping, as a multiple of the shipping time. At 3× with 15-day shipping, you're flagged once the channel drops under 45 days.",
};

export const REORDER_TO_HELP = {
  title: "Order size",
  body: "The default order size: months × units sold per month. At 8 months, a SKU selling 100/mo gets an order of 800 units.",
};

export const BATCH_HELP = {
  title: "Batch size",
  body: "Rounds the order up to a multiple of your co-packer's run size. Blank means no rounding.",
};
