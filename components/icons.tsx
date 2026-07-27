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

function duotone(Glyph: PhosphorIcon): LucideIcon {
  return function Icon({ size = 20, strokeWidth: _ignored, ...rest }: IconProps) {
    return <Glyph size={size} weight="duotone" color="currentColor" aria-hidden focusable="false" {...rest} />;
  };
}

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
export const Settings = duotone(P.Gear);

/* ---- Sidebar nav aliases. One duotone style across the app now, so these simply point at the
   same drawings — kept so the sidebar can diverge again later without touching call sites. ---- */
export const LayoutDashboardFilled = LayoutDashboard;
export const BoxesFilled = Boxes;
export const FlaskConicalFilled = FlaskConical;
export const ArrowLeftRightFilled = ArrowLeftRight;
export const ShoppingCartFilled = ShoppingCart;
export const FileTextFilled = FileText;
export const Building2Filled = Building2;
export const WarehouseFilled = Warehouse;
export const ImagesFilled = Images;

/* ---- Header & theme ---- */
export const Menu = duotone(P.List);
export const Search = duotone(P.MagnifyingGlass);
export const Sun = duotone(P.Sun);
export const Moon = duotone(P.Moon);
export const Monitor = duotone(P.Monitor);

/* ---- Actions ---- */
export const X = duotone(P.X);
export const Plus = duotone(P.Plus);
export const Check = duotone(P.Check);
export const CheckCircle2 = duotone(P.CheckCircle);
export const Pencil = duotone(P.PencilSimple);
export const Trash2 = duotone(P.Trash);
export const Copy = duotone(P.Copy);
export const Upload = duotone(P.UploadSimple);
export const Paperclip = duotone(P.Paperclip);
export const Camera = duotone(P.Camera);
export const Lock = duotone(P.Lock);
export const ExternalLink = duotone(P.ArrowSquareOut);
export const Undo2 = duotone(P.ArrowUUpLeft);
export const CornerDownLeft = duotone(P.KeyReturn);
export const UserPlus = duotone(P.UserPlus);
export const RefreshCw = duotone(P.ArrowsClockwise);

/* ---- Communication & places ---- */
export const Mail = duotone(P.Envelope);
export const Phone = duotone(P.Phone);
export const MapPin = duotone(P.MapPin);

/* ---- Status & data ---- */
export const Bell = duotone(P.Bell);
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
export const GripVertical = duotone(P.DotsSixVertical);
export const Move = duotone(P.ArrowsOutCardinal);
export const Scaling = duotone(P.ArrowsOutSimple);
export const ChevronDown = duotone(P.CaretDown);
export const ChevronLeft = duotone(P.CaretLeft);
export const ChevronRight = duotone(P.CaretRight);
export const ChevronUp = duotone(P.CaretUp);
export const ChevronsUpDown = duotone(P.CaretUpDown);
export const ArrowUpDown = duotone(P.ArrowsDownUp);
export const ArrowRight = duotone(P.ArrowRight);
