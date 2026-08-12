-- Reserved-in-AWD units are already counted in FBA inbound (Amazon creates the FBA shipment the
-- moment a replenishment exists), so they must be subtractable from the AWD side. Additive only.
ALTER TABLE "SkuSnapshot" ADD COLUMN "awdReserved" INTEGER NOT NULL DEFAULT 0;
