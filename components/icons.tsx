import type { ComponentType, SVGProps } from "react";
import * as P from "@shopify/polaris-icons";

/**
 * The app's icon set: Shopify Polaris glyphs behind the names the codebase already uses.
 *
 * Call sites keep the lucide-era names and props (`<Settings size={17} />`), and this file is the
 * single place that decides which drawing each name maps to — so swapping the whole app to another
 * set, or overriding one glyph with a custom SVG, is an edit here and nowhere else.
 *
 * Polaris glyphs are filled shapes on a 20×20 box whose paths carry no fill of their own, so the
 * wrapper stamps fill="currentColor" — without it every icon renders black in both themes.
 * `strokeWidth` is accepted and ignored: it meant something to stroke-based lucide, not here.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
  size?: number | string;
  strokeWidth?: number;
};

/** The component type call sites reference (named for compatibility with the old imports). */
export type LucideIcon = ComponentType<IconProps>;

function polaris(Glyph: ComponentType<SVGProps<SVGSVGElement>>): LucideIcon {
  return function Icon({ size = 20, strokeWidth: _ignored, ...rest }: IconProps) {
    return <Glyph width={size} height={size} fill="currentColor" aria-hidden focusable="false" {...rest} />;
  };
}

/* ---- Navigation ---- */
export const LayoutDashboard = polaris(P.HomeIcon);
export const Boxes = polaris(P.InventoryIcon);
export const FlaskConical = polaris(P.WrenchIcon); // production runs — Polaris has no flask
export const ArrowLeftRight = polaris(P.TransactionIcon);
export const ShoppingCart = polaris(P.CartIcon);
export const FileText = polaris(P.ReceiptIcon);
export const Building2 = polaris(P.StoreIcon);
export const Warehouse = polaris(P.OrganizationIcon);
export const Images = polaris(P.ProductIcon);
export const Settings = polaris(P.SettingsIcon);

/* ---- Header & theme ---- */
export const Menu = polaris(P.MenuIcon);
export const Search = polaris(P.SearchIcon);
export const Sun = polaris(P.SunIcon);
export const Moon = polaris(P.MoonIcon);
export const Monitor = polaris(P.DesktopIcon);

/* ---- Actions ---- */
export const X = polaris(P.XIcon);
export const Plus = polaris(P.PlusIcon);
export const Check = polaris(P.CheckIcon);
export const CheckCircle2 = polaris(P.CheckCircleIcon);
export const Pencil = polaris(P.EditIcon);
export const Trash2 = polaris(P.DeleteIcon);
export const Copy = polaris(P.DuplicateIcon);
export const Upload = polaris(P.UploadIcon);
export const Paperclip = polaris(P.AttachmentIcon);
export const Camera = polaris(P.CameraIcon);
export const Lock = polaris(P.LockIcon);
export const ExternalLink = polaris(P.ExternalIcon);
export const Undo2 = polaris(P.UndoIcon);
export const CornerDownLeft = polaris(P.EnterIcon);
export const UserPlus = polaris(P.PersonAddIcon);
export const RefreshCw = polaris(P.RefreshIcon);

/* ---- Communication & places ---- */
export const Mail = polaris(P.EmailIcon);
export const Phone = polaris(P.PhoneIcon);
export const MapPin = polaris(P.LocationIcon);

/* ---- Status & data ---- */
export const Bell = polaris(P.NotificationIcon);
export const AlertTriangle = polaris(P.AlertTriangleIcon);
export const Info = polaris(P.InfoIcon);
export const CalendarDays = polaris(P.CalendarIcon);
export const Clock = polaris(P.ClockIcon);
export const Truck = polaris(P.DeliveryIcon);
export const Zap = polaris(P.AutomationIcon); // expedite — closest lightning glyph Polaris has
export const Gauge = polaris(P.GaugeIcon);
export const PieChart = polaris(P.ChartDonutIcon);
export const Layers = polaris(P.ChartStackedIcon); // "value by bucket" — stacked series
export const Package = polaris(P.PackageIcon);
export const PackageSearch = polaris(P.SearchResourceIcon);

/* ---- Layout & movement ---- */
export const GripVertical = polaris(P.DragHandleIcon);
export const Move = polaris(P.DragDropIcon);
export const Scaling = polaris(P.MaximizeIcon);
export const ChevronDown = polaris(P.ChevronDownIcon);
export const ChevronLeft = polaris(P.ChevronLeftIcon);
export const ChevronRight = polaris(P.ChevronRightIcon);
export const ChevronUp = polaris(P.ChevronUpIcon);
export const ChevronsUpDown = polaris(P.SelectIcon);
export const ArrowUpDown = polaris(P.SortIcon);
export const ArrowRight = polaris(P.ArrowRightIcon);
