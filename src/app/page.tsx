import { TokenImage } from "@/components/token-image";
import {
  fetchAllFairminters,
  fetchBlockHeight,
  fetchPool,
} from "@/lib/api/counterparty";
import { blocksEta, compact, fromSats, shortAddress } from "@/lib/format";
import {
  type Fairminter,
  isXcp69,
  type LaunchPhase,
  launchPhase,
  openingMultiple,
  saleProgress,
  XCP69_MIN_PARTICIPANTS,
} from "@/lib/xcp69";
import { SHOW_NONCONFORMING } from "@/utils/constants";

export const revalidate = 60;

const MAX_PER_SECTION = 12;

export default async function HomePage() {
  const [fairminters, blockHeight] = await Promise.all([
    fetchAllFairminters(),
    fetchBlockHeight(),
  ]);

  const listed = fairminters.filter((fm) =>
    SHOW_NONCONFORMING
      ? Boolean(fm.asset) && !fm.status.startsWith("invalid")
      : isXcp69(fm),
  );

  // Newest first; the pool row is the graduated-vs-refunded oracle, only
  // worth a lookup for closed pool fairminters.
  listed.sort((a, b) => b.block_index - a.block_index);
  const phased = await Promise.all(
    listed.map(async (fm) => {
      const hasPool =
        fm.status === "closed" && (fm.pool_quantity ?? 0) > 0
          ? (await fetchPool(fm.asset)) !== null
          : false;
      return { fm, phase: launchPhase(fm, hasPool) };
    }),
  );

  const byPhase = (phase: LaunchPhase) =>
    phased.filter((p) => p.phase === phase).slice(0, MAX_PER_SECTION);
  const minting = byPhase("minting");
  const scheduled = byPhase("scheduled");
  const graduated = byPhase("graduated");
  const refunded = byPhase("refunded");

  return (
    <div className="space-y-12">
      {phased.length === 0 && <FirstLaunchHero />}

      <Section
        title="Minting"
        empty="No live launches. Start one — it sells out or everyone gets refunded."
        items={minting}
        render={(fm) => <MintingCard fm={fm} blockHeight={blockHeight} />}
      />
      {scheduled.length > 0 && (
        <Section
          title="Scheduled"
          empty=""
          items={scheduled}
          render={(fm) => <ScheduledCard fm={fm} blockHeight={blockHeight} />}
        />
      )}
      <Section
        title="Graduated"
        empty="No launches have graduated to a pool yet."
        items={graduated}
        render={(fm) => <GraduatedCard fm={fm} />}
      />
      <Section
        title="Graveyard"
        empty="Nothing here. That's good."
        items={refunded}
        render={(fm) => <RefundedCard fm={fm} />}
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
      <a
        href="/create"
        className="mt-6 inline-block rounded-md bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700"
      >
        Launch the first
      </a>
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
  items: { fm: Fairminter }[];
  render: (fm: Fairminter) => React.ReactNode;
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(({ fm }) => (
            <div key={fm.tx_hash}>{render(fm)}</div>
          ))}
        </div>
      )}
    </section>
  );
}

function CardShell({
  fm,
  badge,
  children,
}: {
  fm: Fairminter;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const conforming = isXcp69(fm);
  return (
    <a
      href={`/coin/${fm.tx_hash}`}
      className={`block rounded-lg bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
        conforming ? "holo-border" : "border border-gray-200"
      }`}
    >
      <div className="flex items-center gap-3">
        <TokenImage asset={fm.asset} className="size-10 rounded-full bg-gray-100 object-cover" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{fm.asset_longname ?? fm.asset}</div>
          <div className="text-xs text-gray-500">{shortAddress(fm.source)}</div>
        </div>
        {badge}
      </div>
      <div className="mt-3">{children}</div>
    </a>
  );
}

function MintingCard({ fm, blockHeight }: { fm: Fairminter; blockHeight: number }) {
  const progress = saleProgress(fm);
  const deadline = fm.soft_cap_deadline_block || fm.end_block;
  return (
    <CardShell fm={fm}>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-purple-600"
          style={{ width: `${Math.min(100, progress * 100)}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-600">
        <span>{(progress * 100).toFixed(1)}%</span>
        <span>{deadline > 0 ? `${blocksEta(deadline - blockHeight)} left` : "no deadline"}</span>
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {compact(fromSats(fm.earned_quantity))} of{" "}
        {compact(fromSats(fm.soft_cap > 0 ? fm.soft_cap : fm.hard_cap))} minted
      </div>
    </CardShell>
  );
}

function ScheduledCard({ fm, blockHeight }: { fm: Fairminter; blockHeight: number }) {
  return (
    <CardShell
      fm={fm}
      badge={
        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
          upcoming
        </span>
      }
    >
      <div className="text-xs text-gray-600">
        Minting opens at block {fm.start_block.toLocaleString()} —{" "}
        {blocksEta(fm.start_block - blockHeight)} from now
      </div>
    </CardShell>
  );
}

function GraduatedCard({ fm }: { fm: Fairminter }) {
  const multiple = openingMultiple(fm);
  return (
    <CardShell
      fm={fm}
      badge={
        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
          graduated
        </span>
      }
    >
      <div className="text-xs text-gray-600">
        Sold out · liquidity locked
        {multiple ? ` · pool opened ${multiple.toFixed(2)}× mint` : ""}
      </div>
    </CardShell>
  );
}

function RefundedCard({ fm }: { fm: Fairminter }) {
  const progress = saleProgress(fm);
  return (
    <CardShell fm={fm}>
      <div className="text-xs text-gray-500">
        Closed at {(progress * 100).toFixed(1)}% ·{" "}
        {compact(fromSats(fm.paid_quantity))} XCP{" "}
        {(fm.pool_quantity ?? 0) > 0 ? "refunded" : "collected"}
      </div>
    </CardShell>
  );
}
