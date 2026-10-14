"use client";

import { useCallback, useRef, useState } from "react";
import { demoGroups, demoImages, demoTeardowns } from "@/lib/demo";
import type { Confidence, ImageAnalysis, ProductGroup, Teardown } from "@/lib/schemas";

type Img = {
  id: string;
  name: string;
  thumb: string; // data URL (or emoji for demo)
  data?: string; // base64 JPEG sent to the API
  small?: string; // 512px base64 JPEG for the visual grouping check
  status: "ready" | "analyzing" | "done" | "error";
  analysis?: ImageAnalysis;
  error?: string;
  demo?: boolean;
};

type TeardownState = { status: "loading" | "done" | "error"; teardown?: Teardown; error?: string };

type Phase = "idle" | "analyzing" | "grouping" | "researching" | "done";

const gbp = (n: number) =>
  "£" + n.toLocaleString("en-GB", { maximumFractionDigits: n < 100 ? 2 : 0 });

async function fileToJpeg(file: File, maxSide = 1280): Promise<{ thumb: string; data: string; small: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.82);
  const s = Math.min(1, 512 / Math.max(canvas.width, canvas.height));
  const small = document.createElement("canvas");
  small.width = Math.round(canvas.width * s);
  small.height = Math.round(canvas.height * s);
  small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
  return { thumb: url, data: url.split(",")[1], small: small.toDataURL("image/jpeg", 0.75).split(",")[1] };
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

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

export default function TeardownApp() {
  const [images, setImages] = useState<Img[]>([]);
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [groupMethod, setGroupMethod] = useState<string>("");
  const [teardowns, setTeardowns] = useState<Record<string, TeardownState>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [notices, setNotices] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const patchImage = (id: string, patch: Partial<Img>) =>
    setImages((prev) => prev.map((im) => (im.id === id ? { ...im, ...patch } : im)));

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    for (const file of list) {
      const id = crypto.randomUUID();
      try {
        const { thumb, data, small } = await fileToJpeg(file);
        setImages((prev) => [...prev.filter((p) => !p.demo), { id, name: file.name, thumb, data, small, status: "ready" }]);
      } catch {
        setNotices((n) => [...n, `Couldn't read ${file.name} (HEIC? try exporting as JPEG)`]);
      }
    }
  }, []);

  const reset = () => {
    setImages([]);
    setGroups([]);
    setTeardowns({});
    setPhase("idle");
    setNotices([]);
    setGroupMethod("");
    setSelected([]);
  };

  const runTeardown = async (group: ProductGroup) => {
    setTeardowns((t) => ({ ...t, [group.groupId]: { status: "loading" } }));
    try {
      const { teardown } = await postJson<{ teardown: Teardown }>("/api/teardown", {
        product_guess: group.product_guess,
        is_known_product: group.is_known_product,
        visible_components: group.visible_components,
        description: group.description,
      });
      setTeardowns((t) => ({ ...t, [group.groupId]: { status: "done", teardown } }));
    } catch (err) {
      setTeardowns((t) => ({ ...t, [group.groupId]: { status: "error", error: String(err) } }));
    }
  };

  const run = async () => {
    const todo = images.filter((im) => !im.demo && im.data);
    if (!todo.length) return;
    setGroups([]);
    setTeardowns({});
    setNotices([]);

    // 1. Analyze each photo (3 at a time); failures stay visible and are skipped.
    setPhase("analyzing");
    const analyzed: { imageId: string; analysis: ImageAnalysis; thumb?: string }[] = [];
    await pool(todo, 3, async (im) => {
      if (im.analysis) {
        analyzed.push({ imageId: im.id, analysis: im.analysis, thumb: im.small });
        return;
      }
      patchImage(im.id, { status: "analyzing", error: undefined });
      try {
        const { analysis } = await postJson<{ analysis: ImageAnalysis }>("/api/analyze", {
          mediaType: "image/jpeg",
          data: im.data,
        });
        patchImage(im.id, { status: "done", analysis });
        analyzed.push({ imageId: im.id, analysis, thumb: im.small });
      } catch (err) {
        patchImage(im.id, { status: "error", error: String(err) });
      }
    });
    if (!analyzed.length) {
      setNotices(["Every image failed to analyze. Try demo mode."]);
      setPhase("idle");
      return;
    }

    // 2. Dedupe into products.
    setPhase("grouping");
    let productGroups: ProductGroup[];
    try {
      const res = await postJson<{ groups: ProductGroup[]; method: string; visualCheck: boolean; warnings: string[] }>("/api/group", {
        batchId: crypto.randomUUID(),
        items: analyzed,
      });
      productGroups = res.groups;
      setGroupMethod(res.method + (res.visualCheck ? "+visual" : ""));
      if (res.warnings.length) setNotices((n) => [...n, ...res.warnings]);
    } catch (err) {
      setNotices((n) => [...n, `Grouping failed, treating each photo separately: ${err}`]);
      productGroups = analyzed.map((a, i) => ({ groupId: `solo-${i}`, imageIds: [a.imageId], ...a.analysis }));
      setGroupMethod("none");
    }
    setGroups(productGroups);

    // 3. Teardown per product, in parallel.
    setPhase("researching");
    await Promise.all(productGroups.map(runTeardown));
    setPhase("done");
  };

  // Manual override: combine products the auto-dedupe kept apart, then re-run the teardown.
  const mergeSelected = () => {
    const picked = groups.filter((g) => selected.includes(g.groupId));
    if (picked.length < 2) return;
    const rank = { high: 3, medium: 2, low: 1 } as const;
    const best = [...picked].sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.imageIds.length - a.imageIds.length)[0];
    const merged: ProductGroup = {
      ...best,
      groupId: `merged-${crypto.randomUUID()}`,
      imageIds: picked.flatMap((g) => g.imageIds),
      is_known_product: picked.some((g) => g.is_known_product) && best.is_known_product,
      visible_components: [...new Set(picked.flatMap((g) => g.visible_components))].slice(0, 20),
      description: picked.map((g) => g.description).join(" "),
    };
    const firstIdx = groups.findIndex((g) => selected.includes(g.groupId));
    const next = groups.filter((g) => !selected.includes(g.groupId));
    next.splice(firstIdx, 0, merged);
    setGroups(next);
    setTeardowns((t) => Object.fromEntries(Object.entries(t).filter(([k]) => !selected.includes(k))));
    setSelected([]);
    setGroupMethod((m) => (m.includes("manual") ? m : m + "+manual"));
    if (!groupMethod.startsWith("demo")) runTeardown(merged);
    else
      setTeardowns((t) => ({
        ...t,
        [merged.groupId]: { status: "error", error: "Demo data can't be re-merged. Run live to merge." },
      }));
  };

  const loadDemo = () => {
    reset();
    setImages(demoImages.map((d) => ({ id: d.id, name: d.label, thumb: d.emoji, status: "done", demo: true })));
    setGroups(demoGroups);
    setGroupMethod("demo");
    setTeardowns(
      Object.fromEntries(Object.entries(demoTeardowns).map(([k, teardown]) => [k, { status: "done", teardown }])),
    );
    setPhase("done");
  };

  const imgById = (id: string) => images.find((im) => im.id === id);
  const busy = phase === "analyzing" || phase === "grouping" || phase === "researching";
  const pending = images.filter((im) => !im.demo).length;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Teardown</h1>
          <p className="mt-1 text-neutral-400">Photos in. Bill of materials, build cost and margin out.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadDemo} disabled={busy} className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300 hover:bg-amber-500/20 disabled:opacity-40">
            Demo mode
          </button>
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
        {images.length === 0 ? (
          <div className="py-8 text-neutral-400">
            <div className="text-4xl">📸</div>
            <p className="mt-2">Drop phone photos here, or click to choose</p>
            <p className="text-xs text-neutral-600">Multiple angles of the same thing get merged into one product</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-8" onClick={(e) => e.stopPropagation()}>
            {images.map((im) => (
              <Thumb key={im.id} im={im} />
            ))}
            {!busy && (
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
          disabled={busy || pending === 0}
          className="rounded-lg bg-sky-500 px-5 py-2.5 font-medium text-black hover:bg-sky-400 disabled:bg-neutral-800 disabled:text-neutral-500"
        >
          {busy ? "Working…" : `Tear down ${pending || ""} photo${pending === 1 ? "" : "s"}`}
        </button>
        <PhaseBar phase={phase} images={images} />
      </div>

      {notices.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300">
          {notices.map((n, i) => (
            <li key={i}>⚠ {n}</li>
          ))}
        </ul>
      )}

      {/* 2. Merges */}
      {groups.length > 0 && (
        <section className="mt-10">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
              Deduplication{" "}
              <span className="normal-case tracking-normal text-neutral-600">· {methodLabel(groupMethod)}</span>
            </h2>
            {groups.length > 1 && !busy && (
              <button
                onClick={mergeSelected}
                disabled={selected.length < 2}
                className="rounded-lg border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:border-neutral-800 disabled:text-neutral-600"
              >
                {selected.length < 2 ? "Tick 2+ products to merge them" : `Merge ${selected.length} into one product`}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            {groups.map((g) => (
              <label
                key={g.groupId}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${
                  selected.includes(g.groupId) ? "border-emerald-500/60 bg-emerald-500/5" : "border-neutral-800 bg-neutral-900/50"
                }`}
              >
                {groups.length > 1 && !busy && (
                  <input
                    type="checkbox"
                    className="accent-emerald-500"
                    checked={selected.includes(g.groupId)}
                    onChange={(e) =>
                      setSelected((sel) => (e.target.checked ? [...sel, g.groupId] : sel.filter((x) => x !== g.groupId)))
                    }
                  />
                )}
                <div className="flex -space-x-3">
                  {g.imageIds.slice(0, 4).map((id) => {
                    const im = imgById(id);
                    return im ? <Mini key={id} im={im} /> : null;
                  })}
                </div>
                <div className="text-sm">
                  <span className={g.imageIds.length > 1 ? "font-semibold text-emerald-400" : "text-neutral-400"}>
                    {g.imageIds.length} image{g.imageIds.length > 1 ? "s" : ""} → 1 product
                  </span>
                  <div className="text-neutral-300">{g.product_guess}</div>
                </div>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* 3. Results */}
      <section className="mt-10 space-y-8">
        {groups.map((g) => (
          <ProductCard key={g.groupId} group={g} state={teardowns[g.groupId]} onRetry={() => runTeardown(g)} images={g.imageIds.map(imgById).filter(Boolean) as Img[]} />
        ))}
      </section>
    </main>
  );
}

function methodLabel(m: string) {
  const [base, ...extras] = m.split("+");
  const label =
    base === "vector-search" ? "Atlas Vector Search, cosine ≥ 0.9"
    : base === "local-cosine" ? "embedding cosine ≥ 0.9 (vector index warming up)"
    : base === "name-match" ? "product-name match (embeddings unavailable)"
    : base === "demo" ? "demo data"
    : "not grouped";
  return [label, extras.includes("visual") && "Claude visual check", extras.includes("manual") && "manual merge"]
    .filter(Boolean)
    .join(" + ");
}

function PhaseBar({ phase, images }: { phase: Phase; images: Img[] }) {
  const real = images.filter((i) => !i.demo);
  if (phase === "idle" || real.length === 0) return null;
  const analyzed = real.filter((i) => i.status === "done" || i.status === "error").length;
  const steps: [Phase, string][] = [
    ["analyzing", `Identify (${analyzed}/${real.length})`],
    ["grouping", "Dedupe"],
    ["researching", "Research + BOM"],
  ];
  const order: Phase[] = ["analyzing", "grouping", "researching", "done"];
  const at = order.indexOf(phase);
  return (
    <ol className="flex gap-2 text-xs">
      {steps.map(([p, label], i) => (
        <li
          key={p}
          className={`rounded-full px-3 py-1 ${
            i < at ? "bg-emerald-500/15 text-emerald-300" : i === at ? "animate-pulse bg-sky-500/20 text-sky-300" : "bg-neutral-900 text-neutral-600"
          }`}
        >
          {i < at ? "✓ " : ""}
          {label}
        </li>
      ))}
    </ol>
  );
}

function Mini({ im }: { im: Img }) {
  return im.demo ? (
    <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-neutral-950 bg-neutral-800 text-lg">{im.thumb}</div>
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={im.thumb} alt={im.name} className="h-10 w-10 rounded-lg border-2 border-neutral-950 object-cover" />
  );
}

function Thumb({ im }: { im: Img }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900">
      {im.demo ? (
        <div className="flex h-full items-center justify-center text-4xl">{im.thumb}</div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={im.thumb} alt={im.name} className="h-full w-full object-cover" />
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-1.5 text-left text-[10px] leading-tight">
        {im.status === "analyzing" && <span className="animate-pulse text-sky-300">Identifying…</span>}
        {im.status === "done" && <span className="text-neutral-200">{im.analysis?.product_guess ?? im.name}</span>}
        {im.status === "error" && <span className="text-red-400" title={im.error}>Failed</span>}
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

function ProductCard({ group, state, onRetry, images }: { group: ProductGroup; state?: TeardownState; onRetry: () => void; images: Img[] }) {
  const t = state?.teardown;
  return (
    <article className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/40">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-800 p-5">
        <div className="flex items-center gap-3">
          <div className="flex -space-x-3">
            {images.slice(0, 3).map((im) => (
              <Mini key={im.id} im={im} />
            ))}
          </div>
          <div>
            <h3 className="text-lg font-semibold">{t?.product ?? group.product_guess}</h3>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge className="border-neutral-700 text-neutral-400">{group.is_known_product ? "Known product" : "Custom / prototype"}</Badge>
              <Badge className={confColor[group.confidence]}>ID: {group.confidence}</Badge>
              {t && <Badge className={confColor[t.confidence]}>BOM: {t.confidence} confidence</Badge>}
              {t && (t.live_sources ? <Badge className="border-sky-500/30 text-sky-300">Live sources</Badge> : <Badge className="border-neutral-700 text-neutral-500">Estimate</Badge>)}
            </div>
          </div>
        </div>
      </div>

      {(!state || state.status === "loading") && (
        <div className="animate-pulse p-5 text-sm text-neutral-400">Searching teardowns and component prices…</div>
      )}

      {state?.status === "error" && (
        <div className="flex items-center justify-between gap-4 p-5 text-sm text-red-300">
          <span>{state.error}</span>
          <button onClick={onRetry} className="rounded-lg border border-red-500/40 px-3 py-1.5 hover:bg-red-500/10">
            Retry
          </button>
        </div>
      )}

      {t && (
        <div className="grid gap-6 p-5 lg:grid-cols-[1fr_280px]">
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
            {t.margin_pct != null && (
              <p className="mt-1 text-sm text-neutral-400">
                ≈ <span className="font-semibold text-emerald-400">{t.margin_pct}%</span> gross margin on parts
              </p>
            )}

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="pb-2 font-medium">Part</th>
                    <th className="pb-2 font-medium">Supplier</th>
                    <th className="pb-2 text-right font-medium">Est. £</th>
                    <th className="pb-2 pl-3 font-medium">Src</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/70">
                  {t.bom.map((l, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-3">{l.part}</td>
                      <td className="py-2 pr-3 text-neutral-400">{l.supplier}</td>
                      <td className="py-2 text-right tabular-nums">{gbp(l.est_cost_gbp)}</td>
                      <td className="py-2 pl-3">
                        {l.source_url ? (
                          <a href={l.source_url} target="_blank" rel="noreferrer" className="text-sky-400 hover:underline">
                            ↗
                          </a>
                        ) : (
                          <span className="text-neutral-600" title="Claude estimate">est</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-neutral-700 font-semibold">
                    <td className="pt-2" colSpan={2}>
                      Total
                    </td>
                    <td className="pt-2 text-right tabular-nums text-sky-300">{gbp(t.total_build_cost_gbp)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-3 text-xs text-neutral-500">{t.notes}</p>
            {t.warnings.length > 0 && (
              <ul className="mt-2 text-xs text-amber-400/80">
                {t.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            )}
          </div>

          <aside className="space-y-6">
            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">Similar products</h4>
              {t.similar.length === 0 ? (
                <p className="text-xs text-neutral-600">No past teardowns yet. This one is the first of its kind.</p>
              ) : (
                <ul className="space-y-2">
                  {t.similar.map((s) => (
                    <li key={s.id} className="rounded-lg border border-neutral-800 p-2.5 text-sm">
                      <div className="font-medium">{s.product}</div>
                      <div className="text-xs text-neutral-400">
                        {gbp(s.total_build_cost_gbp)} build{s.retail_price_gbp != null && ` · ${gbp(s.retail_price_gbp)} retail`}
                        {s.score != null && ` · sim ${s.score}`}
                      </div>
                      {s.shared_parts.length > 0 && (
                        <div className="mt-1 text-xs text-emerald-400/80">Shared: {s.shared_parts.slice(0, 3).join(", ")}</div>
                      )}
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
        </div>
      )}
    </article>
  );
}
