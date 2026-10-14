"use client";

import { useCallback, useRef, useState } from "react";
import BuySection from "./buy-section";
import { demoProducts } from "@/lib/demo";
import type { Assembly, Confidence, ImageAnalysis, Offers, Product, Teardown } from "@/lib/schemas";

const MAX_PHOTOS = 8;

type Photo = {
  id: string;
  name: string;
  thumb: string; // data URL, or emoji for demo
  data?: string; // 1024px base64 JPEG for identification
  small?: string; // 512px base64 JPEG for the reasoning step
  demo?: boolean;
};

type Step<T> = { status: "idle" | "loading" | "done" | "error"; value?: T; error?: string };

const idle = { status: "idle" } as const;

const gbp = (n: number) => "£" + n.toLocaleString("en-GB", { maximumFractionDigits: n < 100 ? 2 : 0 });

async function fileToJpeg(file: File): Promise<{ thumb: string; data: string; small: string }> {
  const bitmap = await createImageBitmap(file);
  const draw = (maxSide: number, quality: number) => {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  };
  const url = draw(1024, 0.8);
  return { thumb: url, data: url.split(",")[1], small: draw(512, 0.75).split(",")[1] };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export default function TeardownApp() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [identify, setIdentify] = useState<Step<Product>>(idle);
  const [teardown, setTeardown] = useState<Step<Teardown>>(idle);
  const [assembly, setAssembly] = useState<Step<Assembly>>(idle);
  const [offers, setOffers] = useState<Step<Offers>>(idle);
  const [notice, setNotice] = useState<string>("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isDemo = photos.some((p) => p.demo);
  const busy = [identify, teardown, assembly, offers].some((s) => s.status === "loading");

  const clearResults = () => {
    setIdentify(idle);
    setTeardown(idle);
    setAssembly(idle);
    setOffers(idle);
    setNotice("");
  };

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    for (const file of list) {
      try {
        const { thumb, data, small } = await fileToJpeg(file);
        setPhotos((prev) => {
          const real = prev.filter((p) => !p.demo);
          if (real.length >= MAX_PHOTOS) return real;
          return [...real, { id: crypto.randomUUID(), name: file.name, thumb, data, small }];
        });
      } catch {
        setNotice(`Couldn't read ${file.name} (HEIC? open in Safari or export as JPEG)`);
      }
    }
  }, []);

  const removePhoto = (id: string) => setPhotos((prev) => prev.filter((p) => p.id !== id));

  const reset = () => {
    setPhotos([]);
    clearResults();
  };

  const runAssembly = async (product: Product, t: Teardown, shots: Photo[]) => {
    setAssembly({ status: "loading" });
    try {
      const { assembly } = await postJson<{ assembly: Assembly }>("/api/assembly", {
        teardownId: t.id,
        product: t.product,
        is_known_product: product.is_known_product,
        description: product.description,
        bom: t.bom.map((l) => ({ part: l.part, qty: l.qty })),
        images: shots.map((p) => p.small).filter(Boolean).slice(0, 4),
      });
      setAssembly({ status: "done", value: assembly });
    } catch (err) {
      setAssembly({ status: "error", error: String(err) });
    }
  };

  const runOffers = async (product: Product, t: Teardown) => {
    setOffers({ status: "loading" });
    try {
      const { offers } = await postJson<{ offers: Offers }>("/api/offers", {
        teardownId: t.id,
        product: t.product,
        is_known_product: product.is_known_product,
        bom: t.bom.map(({ part, supplier, qty, unit_cost_gbp, moq }) => ({ part, supplier, qty, unit_cost_gbp, moq })),
      });
      setOffers({ status: "done", value: offers });
    } catch (err) {
      setOffers({ status: "error", error: String(err) });
    }
  };

  const runTeardown = async (product: Product, shots: Photo[]) => {
    setTeardown({ status: "loading" });
    setAssembly(idle);
    setOffers(idle);
    try {
      const { teardown } = await postJson<{ teardown: Teardown }>("/api/teardown", product);
      setTeardown({ status: "done", value: teardown });
      // Sourcing and reasoning only need the BOM: run them side by side.
      await Promise.all([runOffers(product, teardown), runAssembly(product, teardown, shots)]);
    } catch (err) {
      setTeardown({ status: "error", error: String(err) });
    }
  };

  const run = async () => {
    const shots = photos.filter((p) => !p.demo && p.data);
    if (!shots.length) return;
    clearResults();

    // 1. Identify: one Claude call that sees every angle.
    setIdentify({ status: "loading" });
    let product: Product;
    try {
      const { analysis } = await postJson<{ analysis: ImageAnalysis }>("/api/analyze", {
        images: shots.map((p) => ({ mediaType: "image/jpeg", data: p.data })),
      });
      product = analysis;
      setIdentify({ status: "done", value: product });
    } catch (err) {
      setIdentify({ status: "error", error: String(err) });
      return;
    }

    // 2. BOM (Tavily + Claude), then 3. how it fits together.
    await runTeardown(product, shots);
  };

  const loadDemo = (key: string) => {
    const d = demoProducts.find((p) => p.key === key)!;
    reset();
    setPhotos(d.photos.map((label, i) => ({ id: `${d.key}-${i}`, name: label, thumb: d.emoji, demo: true })));
    setIdentify({ status: "done", value: d.product });
    setTeardown({ status: "done", value: d.teardown });
    setAssembly({ status: "done", value: d.teardown.assembly });
    setOffers(d.offers ? { status: "done", value: d.offers } : idle);
  };

  const realCount = photos.filter((p) => !p.demo).length;
  const product = identify.value;
  const t = teardown.value;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Teardown</h1>
          <p className="mt-1 text-neutral-400">Photos of one product in. BOM, build cost and how it fits together out.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {demoProducts.map((d) => (
            <button
              key={d.key}
              onClick={() => loadDemo(d.key)}
              disabled={busy}
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/20 disabled:opacity-40"
            >
              Demo: {d.label}
            </button>
          ))}
          <button onClick={reset} disabled={busy} className="rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-900 disabled:opacity-40">
            Reset
          </button>
        </div>
      </header>

      {/* 1. Upload */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition ${
          dragging ? "border-sky-400 bg-sky-400/5" : "border-neutral-800 hover:border-neutral-700"
        }`}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        {photos.length === 0 ? (
          <div className="py-8 text-neutral-400">
            <div className="text-4xl">📸</div>
            <p className="mt-2">Drop photos of one product here, or click to choose</p>
            <p className="text-xs text-neutral-600">Up to {MAX_PHOTOS} angles and close-ups. More angles mean a better BOM.</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8" onClick={(e) => e.stopPropagation()}>
            {photos.map((p) => (
              <div key={p.id} className="group relative aspect-square overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
                {p.demo ? (
                  <div className="flex h-full flex-col items-center justify-center gap-1 text-4xl">
                    {p.thumb}
                    <span className="text-[10px] text-neutral-500">{p.name}</span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.thumb} alt={p.name} className="h-full w-full object-cover" />
                )}
                {!p.demo && !busy && (
                  <button
                    onClick={() => removePhoto(p.id)}
                    className="absolute right-1 top-1 hidden h-6 w-6 rounded-full bg-black/70 text-xs text-neutral-300 group-hover:block"
                    aria-label="Remove photo"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {!busy && !isDemo && realCount < MAX_PHOTOS && (
              <button onClick={() => inputRef.current?.click()} className="aspect-square rounded-xl border border-dashed border-neutral-800 text-2xl text-neutral-600 hover:border-neutral-600">
                +
              </button>
            )}
          </div>
        )}
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          onClick={run}
          disabled={busy || realCount === 0}
          className="rounded-lg bg-sky-500 px-5 py-2.5 font-medium text-black hover:bg-sky-400 disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {busy ? "Working…" : realCount ? `Tear down (${realCount} photo${realCount === 1 ? "" : "s"})` : "Tear down"}
        </button>
        {!isDemo && <Steps identify={identify} teardown={teardown} assembly={assembly} offers={offers} />}
      </div>

      {notice && <p className="mt-3 text-xs text-amber-300">⚠ {notice}</p>}
      {identify.status === "error" && <ErrorBox msg={identify.error!} onRetry={run} />}

      {product && (
        <article className="mt-10 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/40">
          {/* Product header */}
          <div className="border-b border-neutral-800 p-5">
            <h2 className="text-xl font-semibold">{t?.product ?? product.product_guess}</h2>
            <p className="mt-1 max-w-3xl text-sm text-neutral-400">{product.description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge className="border-neutral-700 text-neutral-400">{product.is_known_product ? "Known product" : "Custom / prototype"}</Badge>
              <Badge className={confColor[product.confidence]}>ID: {product.confidence}</Badge>
              {t && <Badge className={confColor[t.confidence]}>BOM: {t.confidence} confidence</Badge>}
              {t && (t.live_sources ? <Badge className="border-sky-500/30 text-sky-300">Live sources</Badge> : <Badge className="border-neutral-700 text-neutral-500">Estimate</Badge>)}
              {isDemo && <Badge className="border-amber-500/40 text-amber-300">Demo data</Badge>}
            </div>
          </div>

          {teardown.status === "loading" && <Loading text="Searching teardowns and component prices…" />}
          {teardown.status === "error" && (
            <div className="p-5">
              <ErrorBox msg={teardown.error!} onRetry={() => runTeardown(product, photos.filter((p) => !p.demo))} />
            </div>
          )}

          {t && (
            <div className="grid gap-6 p-5 lg:grid-cols-[1fr_280px]">
              <div className="min-w-0">
                <Headline t={t} />
                <BomTable t={t} />
                <p className="mt-3 text-xs text-neutral-500">{t.notes}</p>
                {t.warnings.length > 0 && (
                  <ul className="mt-2 text-xs text-amber-400/80">
                    {t.warnings.map((w, i) => (
                      <li key={i}>⚠ {w}</li>
                    ))}
                  </ul>
                )}
              </div>
              <Sidebar t={t} />
            </div>
          )}

          {/* 3. Where to buy */}
          {t && (offers.status !== "idle" || isDemo) && (
            <div className="border-t border-neutral-800 p-5">
              <h3 className="text-lg font-semibold">{product.is_known_product ? "Where to buy it" : "Where to buy the parts"}</h3>
              {offers.status === "loading" && <Loading text="Finding listings, stock and shipping…" pad={false} />}
              {offers.status === "error" && (
                <div className="mt-3">
                  <ErrorBox msg={offers.error!} onRetry={() => runOffers(product, t)} />
                </div>
              )}
              {offers.status === "idle" && isDemo && <p className="mt-2 text-sm text-neutral-500">Run live to fetch listings.</p>}
              {offers.value && <BuySection t={t} offers={offers.value} />}
              {offers.value && offers.value.warnings.length > 0 && (
                <ul className="mt-3 text-xs text-amber-400/80">
                  {offers.value.warnings.map((w, i) => (
                    <li key={i}>⚠ {w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* 4. Reasoning layer */}
          {t && (
            <div className="border-t border-neutral-800 p-5">
              <h3 className="text-lg font-semibold">How it fits together</h3>
              {assembly.status === "loading" && <Loading text="Reasoning about power, data and mechanical connections…" pad={false} />}
              {assembly.status === "error" && (
                <div className="mt-3">
                  <ErrorBox msg={assembly.error!} onRetry={() => runAssembly(product, t, photos.filter((p) => !p.demo))} />
                </div>
              )}
              {assembly.value && <AssemblyView a={assembly.value} />}
            </div>
          )}
        </article>
      )}
    </main>
  );
}

function Steps({ identify, teardown, assembly, offers }: { identify: Step<unknown>; teardown: Step<unknown>; assembly: Step<unknown>; offers: Step<unknown> }) {
  const items: [string, Step<unknown>][] = [
    ["Identify", identify],
    ["Research + BOM", teardown],
    ["Where to buy", offers],
    ["How it fits", assembly],
  ];
  if (identify.status === "idle") return null;
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {items.map(([label, s]) => (
        <li
          key={label}
          className={`rounded-full px-3 py-1 ${
            s.status === "done"
              ? "bg-emerald-500/15 text-emerald-300"
              : s.status === "loading"
                ? "animate-pulse bg-sky-500/20 text-sky-300"
                : s.status === "error"
                  ? "bg-red-500/15 text-red-300"
                  : "bg-neutral-900 text-neutral-600"
          }`}
        >
          {s.status === "done" ? "✓ " : s.status === "error" ? "✕ " : ""}
          {label}
        </li>
      ))}
    </ol>
  );
}

function Headline({ t }: { t: Teardown }) {
  const moqExtra = t.first_build_cost_gbp - t.total_build_cost_gbp;
  return (
    <div>
      <p className="text-3xl font-semibold tracking-tight sm:text-4xl">
        <span className="text-sky-300">{gbp(t.total_build_cost_gbp)}</span>
        <span className="text-neutral-500"> to build</span>
        {t.retail_price_gbp != null && (
          <>
            <span className="text-neutral-500"> vs </span>
            <span>{gbp(t.retail_price_gbp)}</span>
            <span className="text-neutral-500"> retail</span>
          </>
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-neutral-400">
        <span>Per unit, parts only</span>
        {t.margin_pct != null && (
          <span>
            ≈ <span className="font-semibold text-emerald-400">{t.margin_pct}%</span> gross margin on parts
          </span>
        )}
        {moqExtra > 0.5 && (
          <span>
            First build incl. MOQs: <span className="font-semibold text-amber-300">{gbp(t.first_build_cost_gbp)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function BomTable({ t }: { t: Teardown }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-neutral-500">
          <tr>
            <th className="pb-2 font-medium">Part</th>
            <th className="pb-2 font-medium">Supplier</th>
            <th className="pb-2 text-right font-medium">Qty</th>
            <th className="pb-2 text-right font-medium">Unit £</th>
            <th className="pb-2 text-right font-medium">MOQ</th>
            <th className="pb-2 text-right font-medium">Per unit</th>
            <th className="pb-2 pl-3 font-medium">Src</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">
          {t.bom.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="py-2 pr-3">
                {l.part}
                <div className="text-xs text-neutral-500">{l.price_basis}</div>
              </td>
              <td className="py-2 pr-3 text-neutral-400">{l.supplier}</td>
              <td className="py-2 text-right tabular-nums">{l.qty}</td>
              <td className="py-2 text-right tabular-nums text-neutral-300">{gbp(l.unit_cost_gbp)}</td>
              <td className="py-2 text-right tabular-nums">
                {l.moq ? (
                  <span className="text-amber-300" title={`First order costs ${gbp(l.first_order_gbp)}`}>
                    {l.moq}
                  </span>
                ) : (
                  <span className="text-neutral-600">–</span>
                )}
              </td>
              <td className="py-2 text-right tabular-nums">{gbp(l.line_cost_gbp)}</td>
              <td className="py-2 pl-3">
                {l.source_url ? (
                  <a href={l.source_url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
                    ↗
                  </a>
                ) : (
                  <span className="text-neutral-600" title="Claude estimate">
                    est
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-neutral-700 font-semibold">
            <td className="pt-2" colSpan={5}>
              Total per unit
            </td>
            <td className="pt-2 text-right tabular-nums text-sky-300">{gbp(t.total_build_cost_gbp)}</td>
            <td />
          </tr>
          {t.first_build_cost_gbp - t.total_build_cost_gbp > 0.5 && (
            <tr className="text-neutral-400">
              <td className="pt-1" colSpan={5}>
                First build, MOQs applied
              </td>
              <td className="pt-1 text-right tabular-nums text-amber-300">{gbp(t.first_build_cost_gbp)}</td>
              <td />
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  );
}

function Sidebar({ t }: { t: Teardown }) {
  return (
    <aside className="space-y-6">
      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Similar products</h4>
        {t.similar.length === 0 ? (
          <p className="text-xs text-neutral-600">No similar past teardowns yet.</p>
        ) : (
          <ul className="space-y-2">
            {t.similar.map((s) => (
              <li key={s.id} className="rounded-lg border border-neutral-800 p-2.5 text-sm">
                <div className="font-medium">{s.product}</div>
                <div className="text-xs text-neutral-400">
                  {gbp(s.total_build_cost_gbp)} build{s.retail_price_gbp != null && ` · ${gbp(s.retail_price_gbp)} retail`}
                  {s.score != null && ` · sim ${s.score}`}
                </div>
                {s.shared_parts.length > 0 && <div className="mt-1 text-xs text-emerald-400/80">Shared: {s.shared_parts.slice(0, 3).join(", ")}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Sources</h4>
        {t.sources.length === 0 ? (
          <p className="text-xs text-neutral-600">None, Claude estimate only.</p>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {t.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-sky-400 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

const kindStyle: Record<string, { label: string; cls: string }> = {
  power: { label: "Power", cls: "border-red-500/30 bg-red-500/10 text-red-300" },
  data: { label: "Data", cls: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  signal: { label: "Signal", cls: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
  mechanical: { label: "Mechanical", cls: "border-neutral-600 bg-neutral-800 text-neutral-300" },
  rf: { label: "RF", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
};

function AssemblyView({ a }: { a: Assembly }) {
  const kinds = ["power", "data", "signal", "rf", "mechanical"].filter((k) => a.connections.some((c) => c.kind === k));
  return (
    <div className="mt-3 space-y-6">
      <p className="max-w-3xl text-sm leading-relaxed text-neutral-300">{a.summary}</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Connections</h4>
          <div className="space-y-4">
            {kinds.map((k) => (
              <div key={k}>
                <Badge className={kindStyle[k].cls}>{kindStyle[k].label}</Badge>
                <ul className="mt-2 space-y-2">
                  {a.connections
                    .filter((c) => c.kind === k)
                    .map((c, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">{c.from}</span>
                        <span className="text-neutral-500"> → </span>
                        <span className="font-medium">{c.to}</span>
                        <div className="text-xs text-neutral-400">{c.detail}</div>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Suggested build order</h4>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-neutral-300 marker:text-neutral-600">
              {a.build_steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
          {a.inferred_parts.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Probably also needed (not in photos)</h4>
              <ul className="flex flex-wrap gap-1.5">
                {a.inferred_parts.map((p, i) => (
                  <Badge key={i} className="border-amber-500/30 text-amber-300">
                    {p}
                  </Badge>
                ))}
              </ul>
            </div>
          )}
          {a.risks.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Risks</h4>
              <ul className="space-y-1.5 text-sm text-neutral-300">
                {a.risks.map((r, i) => (
                  <li key={i}>⚠ {r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const confColor: Record<Confidence, string> = {
  high: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-red-500/15 text-red-300 border-red-500/30",
};

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${className}`}>{children}</span>;
}

function Loading({ text, pad = true }: { text: string; pad?: boolean }) {
  return <div className={`animate-pulse text-sm text-neutral-400 ${pad ? "p-5" : "mt-3"}`}>{text}</div>;
}

function ErrorBox({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
      <span className="min-w-0 break-words">{msg}</span>
      <button onClick={onRetry} className="shrink-0 rounded-lg border border-red-500/40 px-3 py-1.5 hover:bg-red-500/10">
        Retry
      </button>
    </div>
  );
}
