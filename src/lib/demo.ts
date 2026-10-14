import type { ProductGroup, Teardown } from "@/lib/schemas";

// Offline fallback for the live demo (no network needed). Figures are
// illustrative estimates, not sourced teardown data.
const search = (q: string) => `https://www.ifixit.com/Search?query=${encodeURIComponent(q)}`;

export type DemoImage = { id: string; label: string; emoji: string };

export const demoImages: DemoImage[] = [
  { id: "d1", label: "AirPods case, closed", emoji: "🎧" },
  { id: "d2", label: "AirPods case, open", emoji: "🎧" },
  { id: "d3", label: "Single earbud", emoji: "🎧" },
  { id: "d4", label: "MacBook, lid open", emoji: "💻" },
  { id: "d5", label: "MacBook, underside", emoji: "💻" },
];

export const demoGroups: ProductGroup[] = [
  {
    groupId: "demo-0",
    imageIds: ["d1", "d2", "d3"],
    product_guess: "Apple AirPods Pro (2nd generation)",
    is_known_product: true,
    confidence: "high",
    visible_components: ["Charging case", "Earbuds", "USB-C port", "Silicone ear tips"],
    description: "White wireless earbuds with a glossy charging case.",
  },
  {
    groupId: "demo-1",
    imageIds: ["d4", "d5"],
    product_guess: "Apple MacBook Air 13-inch (M4)",
    is_known_product: true,
    confidence: "high",
    visible_components: ["Display", "Keyboard", "Trackpad", "Aluminium chassis", "MagSafe port"],
    description: "Thin aluminium laptop with a 13-inch display.",
  },
];

const t = (part: string, supplier: string, cost: number, q: string) => ({
  part,
  supplier,
  est_cost_gbp: cost,
  source_url: search(q),
});

export const demoTeardowns: Record<string, Teardown> = {
  "demo-0": {
    product: "Apple AirPods Pro (2nd generation)",
    is_known_product: true,
    bom: [
      t("H2 chip (x2, one per earbud)", "Apple / TSMC", 14, "AirPods Pro 2 H2"),
      t("Charging case battery + wireless charging coil", "Sunwoda / Luxshare", 9, "AirPods Pro 2 case battery"),
      t("Earbud batteries (x2)", "Varta / EVE", 3, "AirPods Pro 2 battery"),
      t("Drivers + microphones (x2 sets)", "Goertek / Knowles", 7, "AirPods Pro 2 microphone"),
      t("Sensors: skin-detect, force, motion", "STMicro / Bosch", 5, "AirPods Pro 2 sensor"),
      t("Bluetooth antennas + U1 chip", "Apple / Murata", 3, "AirPods Pro 2 antenna"),
      t("Power management + audio amps", "TI / Cirrus Logic", 4, "AirPods Pro 2 logic board"),
      t("Enclosures, mesh, ear tips", "Luxshare", 6, "AirPods Pro 2 ear tips"),
      t("USB-C port + case logic board", "Foxconn", 3, "AirPods Pro 2 USB-C"),
      t("Assembly, test + packaging", "Luxshare / Goertek", 8, "AirPods Pro 2 teardown"),
    ],
    total_build_cost_gbp: 62,
    retail_price_gbp: 229,
    margin_pct: 72.9,
    confidence: "medium",
    notes: "Demo data: illustrative estimate. Run live to fetch sourced figures.",
    sources: [{ title: "iFixit: AirPods Pro 2 teardowns", url: search("AirPods Pro 2 teardown") }],
    live_sources: false,
    warnings: [],
    similar: [
      { id: "demo-1", product: "Apple MacBook Air 13-inch (M4)", total_build_cost_gbp: 329, retail_price_gbp: 999, score: 0.41, shared_parts: ["assembly test packaging"] },
    ],
  },
  "demo-1": {
    product: "Apple MacBook Air 13-inch (M4)",
    is_known_product: true,
    bom: [
      t("M4 SoC (10-core CPU / 8-core GPU)", "Apple / TSMC", 75, "MacBook Air M4 logic board"),
      t("16GB unified memory", "SK Hynix / Micron", 35, "MacBook Air M4 RAM"),
      t("256GB NAND storage", "Kioxia / Samsung", 18, "MacBook Air M4 SSD"),
      t('13.6" Liquid Retina display', "LG Display / BOE", 60, "MacBook Air M4 display"),
      t("Aluminium unibody + machining", "Foxconn / Catcher", 30, "MacBook Air M4 case"),
      t("53.8Wh battery", "Sunwoda / Desay", 18, "MacBook Air M4 battery"),
      t("Keyboard + Touch ID", "Darfon / Apple", 15, "MacBook Air M4 keyboard"),
      t("Force Touch trackpad", "TPK", 12, "MacBook Air M4 trackpad"),
      t("Speakers, mics, 12MP camera", "AAC / Sony", 14, "MacBook Air M4 camera"),
      t("Wi-Fi/BT, PMIC, logic board", "Broadcom / TI", 25, "MacBook Air M4 wifi"),
      t("Power adapter", "Delta / Lite-On", 7, "MacBook Air charger"),
      t("Assembly, test + packaging", "Quanta / Foxconn", 20, "MacBook Air M4 teardown"),
    ],
    total_build_cost_gbp: 329,
    retail_price_gbp: 999,
    margin_pct: 67.1,
    confidence: "medium",
    notes: "Demo data: illustrative estimate. Run live to fetch sourced figures.",
    sources: [{ title: "iFixit: MacBook Air M4 teardowns", url: search("MacBook Air M4 teardown") }],
    live_sources: false,
    warnings: [],
    similar: [
      { id: "demo-0", product: "Apple AirPods Pro (2nd generation)", total_build_cost_gbp: 62, retail_price_gbp: 229, score: 0.41, shared_parts: ["assembly test packaging"] },
    ],
  },
};
