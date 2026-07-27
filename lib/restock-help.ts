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
    "How long a production run takes, from placing it to having finished units in your hands. Production only — getting them to the channel is the shipping time, and new stock isn't sellable until both are done.",
};

export const SHIP_HELP = {
  title: "Shipping time",
  body:
    "How long it takes to move finished stock onto the sales channel, in days. It counts twice: stock at your own warehouse is only sellable this many days from now, and a production run isn't sellable until it has been made and then shipped.",
};

export const BUFFER_HELP = {
  title: "Shipping buffer",
  body:
    "How much cover the channel should still hold when you start moving stock, as a multiple of the shipping time. At 3× with 15-day shipping, the product is flagged to ship once the channel drops under 45 days — leaving two spare shipping windows to get it wrong. Raise it to be more cautious, lower it to hold less stock at the channel.",
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
