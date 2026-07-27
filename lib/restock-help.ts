/** Explanations for the restock settings, shared by the Settings page and the inline editor on
 *  Inventory so the two can't drift apart. */

export const FLOOR_HELP = {
  title: "Floor",
  body:
    "The least cover you want the sales channel to hold, in months. Drop below it and the product gets flagged. Think of it as a tripwire, not a target — a higher floor is safer but ties up more cash in stock.",
};

export const LEAD_HELP = {
  title: "Lead time",
  body:
    "How long a production run takes, from placing the order to having units you can sell. It's what decides whether an order placed today lands before you run out.",
};

export const SHIP_HELP = {
  title: "Shipping time",
  body:
    "How long it takes to move finished stock you already own from your own warehouse onto the sales channel. Much shorter than a production run — that difference is what lets the app tell 'I can fix this next week' apart from 'I need to start a run now'.",
};

export const REORDER_TO_HELP = {
  title: "Reorder to",
  body:
    "When you do order, how many months of cover to bring the channel back up to. The floor decides when to shout; this decides how much. It also sets how much is worth shipping over in one go.",
};

export const BATCH_HELP = {
  title: "Batch size",
  body:
    "The run size your co-packer works in. If they only make 5,000 at a time and the maths says you need 11,300, the recommendation rounds up to 15,000. Leave it blank if you can order any quantity.",
};
