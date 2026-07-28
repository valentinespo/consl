import type { ComponentType, SVGProps } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
// The /ssr entry ships context-free components, so the same import is safe in server and client
// components alike (the default entry uses React context and breaks server rendering).
import * as P from "@phosphor-icons/react/dist/ssr";

/**
 * The app's icon set: Phosphor duotone glyphs behind the names the codebase already uses.
 *
 * Call sites keep the lucide-era names and props (`<Settings size={17} />`), and this file is the
 * single place that decides which drawing each name maps to — so swapping the whole app to another
 * set, or overriding one glyph with a custom SVG, is an edit here and nowhere else.
 *
 * Duotone renders each glyph as two layers — a solid tint at reduced opacity under a stroke — and
 * both derive from currentColor, so every icon follows the surrounding text colour in both themes.
 * `strokeWidth` is accepted and ignored: it meant something to stroke-based lucide, not here.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number | string;
  strokeWidth?: number;
};

/** The component type call sites reference (named for compatibility with the old imports). */
export type LucideIcon = ComponentType<IconProps>;

function wrap(Glyph: PhosphorIcon, weight: "duotone" | "regular"): LucideIcon {
  return function Icon({ size = 20, strokeWidth: _ignored, ...rest }: IconProps) {
    return <Glyph size={size} weight={weight} color="currentColor" aria-hidden focusable="false" {...rest} />;
  };
}

/** Duotone: the expressive weight, for icons that *depict* something — nav glyphs, objects. */
const duotone = (g: PhosphorIcon) => wrap(g, "duotone");
/** Regular outline: for functional marks — arrows, chevrons, crosses, ticks. These live inside
 *  buttons and controls, where the duotone tint layer reads as smudge, not style. */
const regular = (g: PhosphorIcon) => wrap(g, "regular");

/* ---- Navigation ---- */
export const LayoutDashboard = duotone(P.SquaresFour);
export const Boxes = duotone(P.Cube);
export const FlaskConical = duotone(P.Flask); // the flask is back — Phosphor has one
export const ArrowLeftRight = duotone(P.Invoice); // Transactions are invoices here
export const ShoppingCart = duotone(P.ShoppingCart);
export const FileText = duotone(P.Receipt);
export const Building2 = duotone(P.Storefront);
export const Warehouse = duotone(P.Warehouse);
export const Images = duotone(P.Tag);
export const Settings = regular(P.Gear); // lives in the chrome (sidebar foot) — outline weight

/* ---- Sidebar nav aliases. The chrome (sidebar + header) runs outline-weight while page content
   keeps duotone — same drawings, regular stroke, and call sites never change. ---- */
export const LayoutDashboardFilled = regular(P.SquaresFour);
export const BoxesFilled = regular(P.Cube);
export const FlaskConicalFilled = regular(P.Flask);
export const ArrowLeftRightFilled = regular(P.Invoice);
export const ShoppingCartFilled = regular(P.ShoppingCart);
export const FileTextFilled = regular(P.Receipt);
export const Building2Filled = regular(P.Storefront);
export const WarehouseFilled = regular(P.Warehouse);
export const ImagesFilled = regular(P.Tag);
/** Outline storefront for the header's org-mark fallback (chrome runs outline weight). */
export const Building2Outline = regular(P.Storefront);

/* ---- Header & theme — chrome icons, outline weight ---- */
export const Menu = regular(P.List);
export const Search = regular(P.MagnifyingGlass);
export const Sun = regular(P.Sun);
export const Moon = regular(P.Moon);
export const Monitor = regular(P.Monitor);

/* ---- Actions ---- */
export const X = regular(P.X);
export const Plus = regular(P.Plus);
export const Check = regular(P.Check);
export const CheckCircle2 = duotone(P.CheckCircle);
export const Pencil = duotone(P.PencilSimple);
export const Trash2 = duotone(P.Trash);
export const Copy = duotone(P.Copy);
export const Upload = regular(P.UploadSimple);
export const Paperclip = duotone(P.Paperclip);
export const Camera = duotone(P.Camera);
export const Lock = duotone(P.Lock);
export const ExternalLink = regular(P.ArrowSquareOut);
export const Undo2 = regular(P.ArrowUUpLeft);
export const CornerDownLeft = regular(P.KeyReturn);
export const UserPlus = duotone(P.UserPlus);
export const RefreshCw = regular(P.ArrowsClockwise);

/* ---- Communication & places ---- */
export const Mail = duotone(P.Envelope);
export const Phone = duotone(P.Phone);
export const MapPin = duotone(P.MapPin);

/* ---- Status & data ---- */
export const Bell = regular(P.Bell); // header chrome — outline weight
export const AlertTriangle = duotone(P.Warning);
export const Info = duotone(P.Info);
export const CalendarDays = duotone(P.Calendar);
export const Clock = duotone(P.Clock);
export const Truck = duotone(P.Truck);
export const Zap = duotone(P.Lightning); // a real bolt again
export const Gauge = duotone(P.Gauge);
export const PieChart = duotone(P.ChartDonut);
export const Layers = duotone(P.Stack);
export const Package = duotone(P.Package);
export const PackageSearch = duotone(P.ListMagnifyingGlass);

/* ---- Layout & movement ---- */
export const GripVertical = regular(P.DotsSixVertical);
export const Move = regular(P.ArrowsOutCardinal);
export const Scaling = regular(P.ArrowsOutSimple);
export const ChevronDown = regular(P.CaretDown);
export const ChevronLeft = regular(P.CaretLeft);
export const ChevronRight = regular(P.CaretRight);
export const ChevronUp = regular(P.CaretUp);
export const ChevronsUpDown = regular(P.CaretUpDown);
export const ArrowUpDown = regular(P.ArrowsDownUp);
export const ArrowRight = regular(P.ArrowRight);
