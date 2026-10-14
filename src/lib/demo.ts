import type { Assembly, BomRow, Offers, Product, Teardown } from "@/lib/schemas";
import robot from "./demo-robot.json";

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
  offers?: Offers;
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

export const demoProducts: DemoProduct[] = [
  // Recorded from a real live run (Tavily + Claude), replayed offline.
  {
    key: "robot",
    label: "Hopping robot",
    emoji: "🤖",
    photos: ["Full robot", "Leg + spring", "Joint close-up"],
    product: robot.product as Product,
    teardown: robot.teardown as Teardown,
    offers: robot.offers as Offers,
  },
  {
    key: "airpods",
    label: "AirPods Pro 2",
    emoji: "🎧",
    photos: ["Case, closed", "Case, open", "Single earbud"],
    product: { product_guess: airpods.product, is_known_product: true, confidence: "high", visible_components: ["Charging case", "Earbuds", "USB-C port"], description: "White wireless earbuds with a glossy charging case." },
    teardown: airpods,
  },
];
