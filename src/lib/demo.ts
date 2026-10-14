import type { Assembly, BomRow, Product, Teardown } from "@/lib/schemas";

// Offline fallback for the live demo (no network needed). Figures are
// illustrative estimates, not sourced teardown data.
const search = (q: string) => `https://www.ifixit.com/Search?query=${encodeURIComponent(q)}`;

export type DemoProduct = {
  key: string;
  label: string;
  emoji: string;
  photos: string[];
  product: Product;
  teardown: Teardown;
};

const row = (part: string, supplier: string, qty: number, unit: number, basis: string, q: string): BomRow => ({
  part,
  supplier,
  qty,
  unit_cost_gbp: unit,
  moq: null,
  price_basis: basis,
  source_url: search(q),
  line_cost_gbp: Math.round(qty * unit * 100) / 100,
  first_order_gbp: Math.round(qty * unit * 100) / 100,
});

const vol = "est. at mass-production volume";

function teardown(product: string, bom: BomRow[], retail: number, assembly: Assembly, sourceQ: string): Teardown {
  const total = Math.round(bom.reduce((s, l) => s + l.line_cost_gbp, 0) * 100) / 100;
  return {
    product,
    is_known_product: true,
    bom,
    total_build_cost_gbp: total,
    first_build_cost_gbp: total,
    retail_price_gbp: retail,
    margin_pct: Math.round(((retail - total) / retail) * 1000) / 10,
    confidence: "medium",
    notes: "Demo data: illustrative estimate. Run live to fetch sourced figures.",
    sources: [{ title: `iFixit: ${sourceQ}`, url: search(sourceQ) }],
    live_sources: false,
    warnings: [],
    similar: [],
    assembly,
  };
}

const airpods = teardown(
  "Apple AirPods Pro (2nd generation)",
  [
    row("H2 chip", "Apple / TSMC", 2, 7, vol, "AirPods Pro 2 H2"),
    row("Earbud Li-ion button cell", "Varta / EVE", 2, 1.5, vol, "AirPods Pro 2 battery"),
    row("Case battery + wireless charging coil", "Sunwoda / Luxshare", 1, 9, vol, "AirPods Pro 2 case battery"),
    row("Driver + mic module", "Goertek / Knowles", 2, 3.5, vol, "AirPods Pro 2 microphone"),
    row("Sensor set: skin-detect, force, IMU", "STMicro / Bosch", 2, 2.5, vol, "AirPods Pro 2 sensor"),
    row("Antennas + U1 chip", "Apple / Murata", 1, 3, vol, "AirPods Pro 2 antenna"),
    row("PMIC + audio amps", "TI / Cirrus Logic", 1, 4, vol, "AirPods Pro 2 logic board"),
    row("Enclosures, mesh, ear tips", "Luxshare", 1, 6, vol, "AirPods Pro 2 ear tips"),
    row("USB-C port + case logic board", "Foxconn", 1, 3, vol, "AirPods Pro 2 USB-C"),
    row("Assembly, test + packaging", "Luxshare / Goertek", 1, 8, vol, "AirPods Pro 2 teardown"),
  ],
  229,
  {
    summary:
      "Each earbud is a self-contained audio computer: an H2 chip runs Bluetooth, noise cancellation and sensor fusion, powered by a tiny button cell. The case is a charger and battery bank that tops up the buds through pogo pins and is itself charged by USB-C or Qi.",
    connections: [
      { from: "Case battery + wireless charging coil", to: "Earbud Li-ion button cell", kind: "power", detail: "Pogo-pin contacts in the case cradle, ~5V charge via case PMIC" },
      { from: "USB-C port + case logic board", to: "Case battery + wireless charging coil", kind: "power", detail: "5V USB-C or Qi/MagSafe input to the case charger" },
      { from: "H2 chip", to: "Driver + mic module", kind: "signal", detail: "Digital mics in, amplified audio out for ANC loop" },
      { from: "Sensor set: skin-detect, force, IMU", to: "H2 chip", kind: "data", detail: "I2C/SPI sensors for in-ear detection and stem squeeze" },
      { from: "Antennas + U1 chip", to: "H2 chip", kind: "rf", detail: "Bluetooth 5.3 to phone; UWB for Find My precision finding" },
      { from: "Enclosures, mesh, ear tips", to: "Driver + mic module", kind: "mechanical", detail: "Acoustic seals and mesh tune the vent and mic ports" },
    ],
    build_steps: [
      "SMT-assemble the flexible logic board with the H2 and sensors.",
      "Bond the driver and mic module into the acoustic chamber.",
      "Fit the button cell and fold the flex into the stem.",
      "Ultrasonically weld the enclosure halves shut.",
      "Build the case: battery, charge coil, logic board and hinge.",
      "Pair-test buds and case, run ANC and acoustic calibration.",
    ],
    inferred_parts: ["Adhesives and acoustic gaskets", "Hall sensor for lid detection"],
    risks: ["Glued, welded enclosure makes battery replacement effectively impossible", "Button cells degrade first and set the product's lifespan"],
  },
  "AirPods Pro 2 teardown",
);

const macbook = teardown(
  "Apple MacBook Air 13-inch (M4)",
  [
    row("M4 SoC (10-core CPU / 8-core GPU)", "Apple / TSMC", 1, 75, vol, "MacBook Air M4 logic board"),
    row("16GB unified memory", "SK Hynix / Micron", 1, 35, vol, "MacBook Air M4 RAM"),
    row("256GB NAND storage", "Kioxia / Samsung", 1, 18, vol, "MacBook Air M4 SSD"),
    row('13.6" Liquid Retina display', "LG Display / BOE", 1, 60, vol, "MacBook Air M4 display"),
    row("Aluminium unibody + machining", "Foxconn / Catcher", 1, 30, vol, "MacBook Air M4 case"),
    row("53.8Wh battery", "Sunwoda / Desay", 1, 18, vol, "MacBook Air M4 battery"),
    row("Keyboard + Touch ID", "Darfon / Apple", 1, 15, vol, "MacBook Air M4 keyboard"),
    row("Force Touch trackpad", "TPK", 1, 12, vol, "MacBook Air M4 trackpad"),
    row("Speakers, mics, 12MP camera", "AAC / Sony", 1, 14, vol, "MacBook Air M4 camera"),
    row("Wi-Fi/BT, PMIC, logic board", "Broadcom / TI", 1, 25, vol, "MacBook Air M4 wifi"),
    row("Power adapter", "Delta / Lite-On", 1, 7, vol, "MacBook Air charger"),
    row("Assembly, test + packaging", "Quanta / Foxconn", 1, 20, vol, "MacBook Air M4 teardown"),
  ],
  999,
  {
    summary:
      "A fanless design built around the M4 SoC with memory on-package and NAND soldered to a compact logic board. The battery fills most of the chassis, and the aluminium unibody doubles as the heat spreader.",
    connections: [
      { from: "Power adapter", to: "Wi-Fi/BT, PMIC, logic board", kind: "power", detail: "USB-C / MagSafe PD input, up to ~70W" },
      { from: "53.8Wh battery", to: "Wi-Fi/BT, PMIC, logic board", kind: "power", detail: "~11.4V pack into PMIC rails" },
      { from: "M4 SoC (10-core CPU / 8-core GPU)", to: "16GB unified memory", kind: "data", detail: "On-package LPDDR5X" },
      { from: "M4 SoC (10-core CPU / 8-core GPU)", to: "256GB NAND storage", kind: "data", detail: "Apple fabric SSD controller in the SoC" },
      { from: "M4 SoC (10-core CPU / 8-core GPU)", to: '13.6" Liquid Retina display', kind: "data", detail: "eDP flex through the hinge" },
      { from: "Keyboard + Touch ID", to: "M4 SoC (10-core CPU / 8-core GPU)", kind: "data", detail: "Secure Enclave link for Touch ID" },
      { from: "Aluminium unibody + machining", to: "M4 SoC (10-core CPU / 8-core GPU)", kind: "mechanical", detail: "Thermal spreader to chassis, no fan" },
    ],
    build_steps: [
      "CNC-machine the unibody from an aluminium block and anodise it.",
      "SMT-assemble the logic board around the M4 package.",
      "Glue the battery cells into the bottom case.",
      "Install the logic board, speakers and trackpad, then route the flexes.",
      "Attach the display assembly through the hinge and connect eDP.",
      "Close the bottom case, flash firmware and run burn-in tests.",
    ],
    inferred_parts: ["Thermal spreader / graphite sheet", "Hinge assembly", "Battery management IC"],
    risks: ["Fanless design throttles under sustained load", "Soldered RAM and SSD mean no upgrades or repairs"],
  },
  "MacBook Air M4 teardown",
);

export const demoProducts: DemoProduct[] = [
  {
    key: "airpods",
    label: "AirPods Pro 2",
    emoji: "🎧",
    photos: ["Case, closed", "Case, open", "Single earbud"],
    product: { product_guess: airpods.product, is_known_product: true, confidence: "high", visible_components: ["Charging case", "Earbuds", "USB-C port"], description: "White wireless earbuds with a glossy charging case." },
    teardown: { ...airpods, similar: [{ id: "macbook", product: macbook.product, total_build_cost_gbp: macbook.total_build_cost_gbp, retail_price_gbp: 999, score: 0.62, shared_parts: ["assembly test packaging"] }] },
  },
  {
    key: "macbook",
    label: "MacBook Air M4",
    emoji: "💻",
    photos: ["Lid open", "Underside"],
    product: { product_guess: macbook.product, is_known_product: true, confidence: "high", visible_components: ["Display", "Keyboard", "Trackpad", "MagSafe port"], description: "Thin aluminium laptop with a 13-inch display." },
    teardown: { ...macbook, similar: [{ id: "airpods", product: airpods.product, total_build_cost_gbp: airpods.total_build_cost_gbp, retail_price_gbp: 229, score: 0.62, shared_parts: ["assembly test packaging"] }] },
  },
];
