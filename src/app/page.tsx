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
  launchPhase,
  saleProgress,
  XCP69_MIN_PARTICIPANTS,
  XCP69_OPENING_MULTIPLE,
} from "@/lib/xcp69";

export const revalidate = 60;

export default async function HomePage() {
  const [fairminters, blockHeight] = await Promise.all([
    fetchAllFairminters(),
    fetchBlockHeight(),
  ]);

  const conforming = fairminters.filter(isXcp69);
  // Success and failure both end "closed"; the pool row is the oracle.
  const phased = await Promise.all(
    conforming.map(async (fm) => {
      const hasPool =
        fm.status === "closed" ? (await fetchPool(fm.asset)) !== null : false;
      return { fm, phase: launchPhase(fm, hasPool) };
    }),
  );

  const launching = phased.filter((p) => p.phase === "launching");
  const launched = phased.filter((p) => p.phase === "launched");
  const refunded = phased.filter((p) => p.phase === "refunded");

  return (
    <div className="space-y-12">
      {conforming.length === 0 && <FirstLaunchHero />}

      <Section
        title="Launching"
        empty="No live launches. Start one — it sells out or everyone gets refunded."
        items={launching}
        render={(fm) => <LaunchingCard fm={fm} blockHeight={blockHeight} />}
      />
      <Section
        title="Launched"
        empty="No launches have closed successfully yet."
        items={launched}
        render={(fm) => <LaunchedCard fm={fm} />}
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
  children,
}: {
  fm: Fairminter;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`/launch/${encodeURIComponent(fm.asset)}`}
      className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <TokenImage asset={fm.asset} className="size-10 rounded-full bg-gray-100" />
        <div className="min-w-0">
          <div className="truncate font-bold">{fm.asset}</div>
          <div className="text-xs text-gray-500">{shortAddress(fm.source)}</div>
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </a>
  );
}

function LaunchingCard({
  fm,
  blockHeight,
}: {
  fm: Fairminter;
  blockHeight: number;
}) {
  const progress = saleProgress(fm);
  const blocksLeft = fm.soft_cap_deadline_block - blockHeight;
  return (
    <CardShell fm={fm}>
      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
        <div
          className="h-full rounded-full bg-purple-600"
          style={{ width: `${Math.min(100, progress * 100)}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-gray-600">
        <span>{(progress * 100).toFixed(1)}% of 69M</span>
        <span>{blocksEta(blocksLeft)} left</span>
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {compact(fromSats(fm.paid_quantity))} XCP raised
      </div>
    </CardShell>
  );
}

function LaunchedCard({ fm }: { fm: Fairminter }) {
  return (
    <CardShell fm={fm}>
      <div className="text-xs text-gray-600">
        Sold out · pool opened at {XCP69_OPENING_MULTIPLE.toFixed(2)}× mint ·
        liquidity locked
      </div>
    </CardShell>
  );
}

function RefundedCard({ fm }: { fm: Fairminter }) {
  const progress = saleProgress(fm);
  return (
    <CardShell fm={fm}>
      <div className="text-xs text-gray-500">
        Reached {(progress * 100).toFixed(1)}% — all{" "}
        {compact(fromSats(fm.paid_quantity))} XCP refunded
      </div>
    </CardShell>
  );
}
