import Link from "next/link";
import { TokenImage } from "@/components/token-image";
import {
  fetchAllFairminters,
  fetchBlockHeight,
  fetchOriginalDeadline,
  fetchPool,
} from "@/lib/api/counterparty";
import { fetchXcpUsd } from "@/lib/api/price";
import {
  blocksEta,
  compact,
  fromSats,
  shortAddress,
  tokenQty,
  usd,
} from "@/lib/format";
import { big } from "@/lib/numeric";
import {
  type Fairminter,
  isXcp69,
  type LaunchPhase,
  launchPhase,
  openingMultiple,
  saleProgress,
  saleTarget,
  windowIsExact,
  XCP69_MIN_PARTICIPANTS,
} from "@/lib/xcp69";
import { SHOW_NONCONFORMING } from "@/utils/constants";

export const revalidate = 60;

const MAX_PER_SECTION = 12;

export default async function HomePage() {
  const [fairminters, blockHeight, xcpUsd] = await Promise.all([
    fetchAllFairminters(),
    fetchBlockHeight(),
    fetchXcpUsd(),
  ]);

  const listed = fairminters.filter((fm) =>
    SHOW_NONCONFORMING
      ? Boolean(fm.asset) && !fm.status.startsWith("invalid")
      : isXcp69(fm),
  );

  // Newest first; the pool row is the graduated-vs-refunded oracle, only
  // worth a lookup for closed pool fairminters.
  listed.sort((a, b) => b.block_index - a.block_index);
  const phased = (
    await Promise.all(
      listed.map(async (fm) => {
        const closed = fm.status === "closed";
        const [pool, originalDeadline] = await Promise.all([
          closed && big(fm.pool_quantity) > 0n
            ? fetchPool(fm.asset)
            : Promise.resolve(null),
          // Closed rows can't prove their composed window (rewritten on
          // early fills); the NEW_FAIRMINTER event can.
          closed && isXcp69(fm) ? fetchOriginalDeadline(fm.tx_hash) : null,
        ]);
        const conforming =
          isXcp69(fm) && (!closed || windowIsExact(fm, originalDeadline));
        // Same fixed supply everywhere, so XCP depth IS the value ranking:
        // Exact sort key: near-equal pools must not swap places between
        // renders.
        const xcpDepth = big(
          pool ? (pool.asset_a === "XCP" ? pool.reserve_a : pool.reserve_b) : 0,
        );
        return { fm, phase: launchPhase(fm, pool !== null), conforming, xcpDepth };
      }),
    )
  ).filter((p) => SHOW_NONCONFORMING || p.conforming);

  const byPhase = (phase: LaunchPhase) =>
    phased.filter((p) => p.phase === phase).slice(0, MAX_PER_SECTION);
  const minting = byPhase("minting");
  const scheduled = byPhase("scheduled");
  const refunded = byPhase("refunded");
  // Featured: graduated first, ranked by pool depth, top 8.
  const graduated = phased
    .filter((p) => p.phase === "graduated")
    .sort((a, b) => (b.xcpDepth === a.xcpDepth ? 0 : b.xcpDepth > a.xcpDepth ? 1 : -1))
    .slice(0, 8);

  return (
    <div className="space-y-12">
      {phased.length === 0 && <FirstLaunchHero />}

      {graduated.length > 0 && (
        <Section
          title="Graduated"
          empty=""
          items={graduated}
          render={({ fm, conforming, xcpDepth }) => (
            <GraduatedCard
              fm={fm}
              conforming={conforming}
              xcpDepth={xcpDepth}
              xcpUsd={xcpUsd}
            />
          )}
        />
      )}
      <Section
        title="Minting"
        empty="No live launches. Start one — it sells out or everyone gets refunded."
        items={minting}
        render={({ fm, conforming }) => (
          <MintingCard fm={fm} conforming={conforming} blockHeight={blockHeight} />
        )}
      />
      {scheduled.length > 0 && (
        <Section
          title="Scheduled"
          empty=""
          items={scheduled}
          render={({ fm, conforming }) => (
            <ScheduledCard fm={fm} conforming={conforming} blockHeight={blockHeight} />
          )}
        />
      )}
      <Section
        title="Graveyard"
        empty="Nothing here. That's good."
        items={refunded}
        render={({ fm, conforming }) => (
          <RefundedCard fm={fm} conforming={conforming} />
        )}
      />
    </div>
  );
}

function FirstLaunchHero() {
  return (
    <div className="holo-border rounded-xl p-8 text-center">
      <h1 className="text-2xl font-bold">Fairmint pools are live.</h1>
      <p className="mx-auto mt-3 max-w-xl text-gray-600">
        The first XCP-69 launch in history hasn&apos;t happened yet. All-or-nothing
        mints, at least {XCP69_MIN_PARTICIPANTS} participants required, every
        raised XCP locked into the pool forever — enforced by consensus, not by
        this website.
      </p>
      <Link
        href="/create"
        className="mt-6 inline-block rounded-md bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700"
      >
        Launch the first
      </Link>
    </div>
  );
}

function Section({
  title,
  empty,
  items,
  render,
}: {
  title: string;
  empty: string;
  items: { fm: Fairminter; conforming: boolean; xcpDepth: bigint }[];
  render: (item: {
    fm: Fairminter;
    conforming: boolean;
    xcpDepth: bigint;
  }) => React.ReactNode;
}) {
  if (items.length === 0 && !empty) return null;
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold">{title}</h2>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
          {empty}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.fm.tx_hash}>{render(item)}</div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Media-first card: the art is the card; identity and one stat ride a bottom
 * gradient, phase chips sit top-left, and (while minting) the progress bar
 * runs along the image's bottom edge.
 */
function CardShell({
  fm,
  conforming,
  chip,
  headline,
  progress,
  children,
}: {
  fm: Fairminter;
  conforming: boolean;
  chip?: React.ReactNode;
  headline?: string;
  progress?: number;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/${fm.asset}`}
      className={`group block overflow-hidden rounded-xl bg-white shadow-sm transition-shadow hover:shadow-md ${
        conforming ? "holo-border" : "border border-gray-200"
      }`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-gray-100">
        <TokenImage
          asset={fm.asset}
          large
          className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {chip && <div className="absolute left-2 top-2">{chip}</div>}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-3 pt-10">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-lg font-bold text-white">
              {fm.asset_longname ?? fm.asset}
            </span>
            {headline && (
              <span className="shrink-0 text-xs font-medium text-white/80">{headline}</span>
            )}
          </div>
        </div>
        {progress !== undefined && (
          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/30">
            <div
              className="h-full bg-purple-500"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div className="p-3 text-xs text-gray-600">{children}</div>
    </Link>
  );
}

function Chip({ tone, children }: { tone: "dark" | "blue" | "green" | "gray"; children: React.ReactNode }) {
  const tones = {
    dark: "bg-black/60 text-white",
    blue: "bg-blue-600/80 text-white",
    green: "bg-green-600/80 text-white",
    gray: "bg-black/40 text-white/90",
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium backdrop-blur-sm ${tones[tone]}`}>
      {children}
    </span>
  );
}

function MintingCard({
  fm,
  conforming,
  blockHeight,
}: {
  fm: Fairminter;
  conforming: boolean;
  blockHeight: number;
}) {
  const progress = saleProgress(fm);
  const deadline = fm.soft_cap_deadline_block || fm.end_block;
  return (
    <CardShell
      fm={fm}
      conforming={conforming}
      progress={progress}
      headline={`${(progress * 100).toFixed(1)}%`}
      chip={
        <Chip tone="dark">
          {deadline > 0 ? `${blocksEta(deadline - blockHeight)} left` : "minting"}
        </Chip>
      }
    >
      {compact(tokenQty(fm.earned_quantity, fm.divisible))} of{" "}
      {big(fm.soft_cap) > 0n || big(fm.hard_cap) > 0n
        ? compact(tokenQty(saleTarget(fm), fm.divisible))
        : "∞"}{" "}
      minted · by {shortAddress(fm.source)}
    </CardShell>
  );
}

function ScheduledCard({
  fm,
  conforming,
  blockHeight,
}: {
  fm: Fairminter;
  conforming: boolean;
  blockHeight: number;
}) {
  return (
    <CardShell
      fm={fm}
      conforming={conforming}
      headline={`opens ${blocksEta(fm.start_block - blockHeight)}`}
      chip={<Chip tone="blue">upcoming</Chip>}
    >
      Minting opens at block {fm.start_block.toLocaleString()} — announced on-chain,
      nobody can mint early
    </CardShell>
  );
}

function GraduatedCard({
  fm,
  conforming,
  xcpDepth,
  xcpUsd,
}: {
  fm: Fairminter;
  conforming: boolean;
  xcpDepth: bigint;
  xcpUsd: number | null;
}) {
  const multiple = openingMultiple(fm);
  return (
    <CardShell
      fm={fm}
      conforming={conforming}
      headline={
        xcpDepth > 0n
          ? `${compact(fromSats(xcpDepth))} XCP deep`
          : multiple
            ? `${multiple.toFixed(2)}× at open`
            : undefined
      }
      chip={<Chip tone="green">graduated</Chip>}
    >
      {xcpDepth > 0n ? (
        <>
          Sold out · liquidity locked forever
          {xcpUsd ? ` · ≈ ${usd(fromSats(xcpDepth) * xcpUsd)}` : ""}
        </>
      ) : (
        "Minted out"
      )}
    </CardShell>
  );
}

function RefundedCard({ fm, conforming }: { fm: Fairminter; conforming: boolean }) {
  const progress = saleProgress(fm);
  return (
    <CardShell
      fm={fm}
      conforming={conforming}
      headline={`${(progress * 100).toFixed(1)}% reached`}
      chip={<Chip tone="gray">refunded</Chip>}
    >
      {compact(fromSats(fm.paid_quantity))} XCP{" "}
      {big(fm.pool_quantity) > 0n ? "refunded by the protocol" : "collected"}
    </CardShell>
  );
}
