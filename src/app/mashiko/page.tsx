import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "益子焼 — 準備中",
  description: "益子の窯元から、受注で器を届ける仕組みを整えています。いまは販売していません。",
  robots: { index: false, follow: false },
};

const kilns = [
  {
    name: "大誠窯",
    makers: "大塚邦紀（6代）・大塚誠一（7代）",
    body: "益子土、柿釉（ほか糠白・黒・飴・糠青磁）、登り窯。日用の器。",
    order: "受注・価格＝窯元確認",
  },
  {
    name: "明窯",
    makers: "井上夫妻",
    body: "工房釉（桜灰・藁灰）。普段使い。公開情報では一点からオーダー可。",
    order: "受注・価格＝窯元確認",
  },
  {
    name: "古窯いわした（岩下製陶）",
    makers: "岩下哲夫（5代）・宗晶（6代）",
    body: "伝統釉、登り窯。器・酒器。",
    order: "受注・価格＝窯元確認",
  },
] as const;

function PhotoSlot({ label }: { label: string }) {
  return (
    <div className="flex aspect-[4/3] items-center justify-center border border-dashed border-[var(--border)] bg-[var(--bg)] px-3 text-center">
      <span className="text-label font-medium tracking-[0.18em] text-[var(--text-muted)]">
        {label}
      </span>
    </div>
  );
}

export default function MashikoPage() {
  return (
    <section className="border-t border-[var(--border)] bg-[var(--bg-warm)] px-4 py-20 md:px-6 md:py-32">
      <div className="mx-auto w-full max-w-3xl space-y-12">
        <header className="space-y-4">
          <p className="text-label font-medium uppercase tracking-[0.22em] text-[var(--gold-text)]">
            準備中 / 受注・工房直送 / これは販売ではありません
          </p>
          <h1 className="text-page">益子焼</h1>
          <p className="font-sans text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">
            益子の窯元から、受注で器を届ける仕組みを整えています。いまは販売していません。
          </p>
          <p className="font-sans text-body-sm font-light leading-[1.8] text-[var(--text-muted)]">
            写真は窯元で撮ります。在庫写真や他店のカタログは使いません。
          </p>
        </header>

        <div className="space-y-10">
          {kilns.map((kiln) => (
            <article
              key={kiln.name}
              className="space-y-5 border border-[var(--border)] bg-[var(--bg)] p-6 md:p-8"
            >
              <div className="space-y-1">
                <h2 className="text-xl font-medium text-[var(--text)]">{kiln.name}</h2>
                <p className="text-body-sm text-[var(--text-muted)]">{kiln.makers}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <PhotoSlot label="手と器（スケール）" />
                <PhotoSlot label="底・印" />
              </div>
              <p className="font-sans text-body-sm font-light leading-[1.8] text-[var(--text)]">
                {kiln.body}
              </p>
              <p className="text-label font-medium tracking-[0.14em] text-[var(--gold-text)]">
                {kiln.order}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
