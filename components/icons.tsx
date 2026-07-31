import type { ComponentType, SVGProps } from "react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
// The /ssr entry ships context-free components, so the same import is safe in server and client
// components alike (the default entry uses React context and breaks server rendering).
import * as P from "@phosphor-icons/react/dist/ssr";

/**
 * The app's icon set: Phosphor regular-weight (outline) glyphs behind the names the codebase
 * already uses. One weight everywhere — the duotone era ended with the efferd-style chrome.
 *
 * Call sites keep the lucide-era names and props (`<Settings size={17} />`), and this file is the
 * single place that decides which drawing each name maps to — so swapping the whole app to another
 * set, or overriding one glyph with a custom SVG, is an edit here and nowhere else.
 * Every glyph draws from currentColor, so icons follow the surrounding text colour in both themes.
 * `strokeWidth` is accepted and ignored: it meant something to stroke-based lucide, not here.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number | string;
  strokeWidth?: number;
};

/** The component type call sites reference (named for compatibility with the old imports). */
export type LucideIcon = ComponentType<IconProps>;

function wrap(Glyph: PhosphorIcon, weight: "regular"): LucideIcon {
  return function Icon({ size = 20, strokeWidth: _ignored, ...rest }: IconProps) {
    return <Glyph size={size} weight={weight} color="currentColor" aria-hidden focusable="false" {...rest} />;
  };
}

/** Regular outline — the app's single icon weight. */
const regular = (g: PhosphorIcon) => wrap(g, "regular");

/* ---- Navigation ---- */
export const LayoutDashboard = regular(P.SquaresFour);
export const Boxes = regular(P.Cube);
export const FlaskConical = regular(P.Flask); // the flask is back — Phosphor has one
export const ArrowLeftRight = regular(P.Invoice); // Transactions are invoices here
export const ShoppingCart = regular(P.ShoppingCart);
export const FileText = regular(P.Receipt);
export const Building2 = regular(P.Storefront);
export const Warehouse = regular(P.Warehouse);
export const Images = regular(P.Tag);
export const Settings = regular(P.Gear); // lives in the chrome (sidebar foot) — outline weight

/* ---- Sidebar nav aliases. Identical to the plain names now (one outline weight app-wide) —
   kept so the sidebar can diverge again later without touching call sites. ---- */
export const LayoutDashboardFilled = regular(P.SquaresFour);
export const BoxesFilled = regular(P.Cube);
export const FlaskConicalFilled = regular(P.Flask);
export const ArrowLeftRightFilled = regular(P.Invoice);
export const ShoppingCartFilled = regular(P.ShoppingCart);
export const FileTextFilled = regular(P.Receipt);
export const Building2Filled = regular(P.Storefront);
export const WarehouseFilled = regular(P.Warehouse);
export const ImagesFilled = regular(P.Tag);
/** Reorder / restock recommendations — a circular "order again" arrow. */
export const ReorderFilled = regular(P.ArrowClockwise);
/** Integrations — two plugs meeting. */
export const Plug = regular(P.Plugs);
export const Download = regular(P.DownloadSimple);
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
export const CheckCircle2 = regular(P.CheckCircle);
export const Pencil = regular(P.PencilSimple);
export const Trash2 = regular(P.Trash);
export const Copy = regular(P.Copy);
export const Upload = regular(P.UploadSimple);
export const Paperclip = regular(P.Paperclip);
export const Camera = regular(P.Camera);
export const Lock = regular(P.Lock);
export const ExternalLink = regular(P.ArrowSquareOut);
export const Undo2 = regular(P.ArrowUUpLeft);
export const CornerDownLeft = regular(P.KeyReturn);
export const UserPlus = regular(P.UserPlus);
export const RefreshCw = regular(P.ArrowsClockwise);

/* ---- Communication & places ---- */
export const Mail = regular(P.Envelope);
export const Phone = regular(P.Phone);
export const MapPin = regular(P.MapPin);

/* ---- Status & data ---- */
export const Bell = regular(P.Bell); // header chrome — outline weight
export const AlertTriangle = regular(P.Warning);
export const Info = regular(P.Info);
export const CalendarDays = regular(P.Calendar);
export const Clock = regular(P.Clock);
export const Truck = regular(P.Truck);
export const Zap = regular(P.Lightning); // a real bolt again
export const Gauge = regular(P.Gauge);
export const PieChart = regular(P.ChartDonut);
export const Layers = regular(P.Stack);
export const Package = regular(P.Package);
export const PackageSearch = regular(P.ListMagnifyingGlass);

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
export const TrendingUp = regular(P.TrendUp);
export const TrendingDown = regular(P.TrendDown);
