/** Explanations for the two restock settings, shared by the Settings page and the inline editor
 *  on Inventory so they can't drift apart. */
export const FLOOR_HELP = {
  title: "Floor",
  body:
    "The least cover you want the sales channel to hold, in months. Drop below it and the product is flagged to reorder. A higher floor is safer but ties up more cash in stock.",
};

export const LEAD_HELP = {
  title: "Lead time",
  body:
    "How long it takes from placing an order to having units you can actually sell — production plus shipping in. It's what decides whether an order placed today lands before you run out.",
};
