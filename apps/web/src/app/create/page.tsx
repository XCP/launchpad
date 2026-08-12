"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { AmountInput } from "@/components/amount-input";
import { ConnectButton } from "@/components/connect-button";
import { CTA } from "@/components/ui/button";
import { GearPopover } from "@/components/ui/popover";
import { trackTx } from "@/lib/analytics";
import { fetchBtcUsd, fetchXcpUsd } from "@/lib/api/price";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";
import { fromSats, commas, usd } from "@/lib/format";
import { inscribeLaunch, type InscribeStep } from "@/lib/inscribe-launch";
import { SATS } from "@/lib/numeric";
import { isValidTelegram, isValidX } from "@/lib/social";
import { fetchPriorityFeeRate, useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import {
  generateLpAssetName,
  XCP69,
  XCP69_EXACT,
  XCP69_RAISE_SATS,
} from "@/lib/xcp69";

const ASSET_NAME_REGEX = /^[B-Z][A-Z]{3,11}$/;

/**
 * "View launch page", held back until that page will actually render.
 *
 * Broadcasting is not the same as being visible. For a few seconds after the
 * wallet returns a txid, Counterparty's own mempool feed hasn't picked the
 * transaction up yet — and the launch page, finding neither a confirmed
 * fairminter nor a pending one, correctly 404s. Offering the link in that
 * window sent people to a dead page seconds after the most important thing
 * they'd done on the site, and the only way out was a manual refresh they
 * had no reason to expect would work.
 *
 * So the button waits for the answer instead of guessing at a delay: it asks
 * the same two questions the launch page asks, every couple of seconds, and
 * only becomes a link once one of them says yes. Polling stops the moment it
 * does.
 */
function ViewLaunchLink({ asset }: { asset: string }) {
  const { data: visible } = useSWR(
    ["launch-visible", asset],
    async () => {
      // Confirmed first: a launch that made it into a block on the very next
      // one shouldn't be reported as still pending.
      const confirmed = await fetch(
        `${COUNTERPARTY_API_BASE}/assets/${asset}/fairminters`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (Array.isArray(confirmed?.result) && confirmed.result.length > 0) return true;

      const pending = await fetch(
        `${COUNTERPARTY_API_BASE}/mempool/events/NEW_FAIRMINTER?limit=500`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      return (
        Array.isArray(pending?.result) &&
        pending.result.some(
          (e: { params?: { asset?: string } }) => e.params?.asset === asset,
        )
      );
    },
    {
      refreshInterval: (latest) => (latest ? 0 : 2_500),
      revalidateOnFocus: false,
    },
  );

  if (!visible) {
    return (
      <span className="mt-6 inline-flex items-center gap-2 rounded-md bg-gray-100 px-5 py-2.5 font-medium text-gray-400">
        {/* A spinner, so the wait reads as work rather than as a dead
            button someone should give up on. */}
        <span className="size-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500" />
        Waiting for the network…
      </span>
    );
  }

  return (
    <a
      href={`/${asset}`}
      className="mt-6 inline-block rounded-md bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700"
    >
      View launch page
    </a>
  );
}

/**
 * Inscribed images live in the reveal witness, chunked into 520-byte
 * pushes alongside the fairminter's own CBOR metadata in the same
 * script — both count against Bitcoin's 400,000-weight standardness
 * ceiling (MAX_STANDARD_TX_WEIGHT; a mempool policy default, not
 * consensus, but the one that determines whether the reveal tx actually
 * relays). Worked backward from the exact weight formula
 * (apps/web/src/lib/inscriber/transactions.ts's estimateRevealWeight):
 * 400 KB of body already overshoots the ceiling by ~12,700 weight units
 * in the worst realistic case (long asset name, long hosted JSON URL,
 * a longer mime type like image/svg+xml) — a launch in that gap would
 * broadcast a transaction most public mempools simply refuse to relay.
 * 385 KB keeps every real launch under the ceiling with room to spare.
 */
const INSCRIBE_MAX_BYTES = 385 * 1024;

/** A named-asset registration is a fixed protocol fee, paid in the same
 *  compose transaction — not a separate step. */
const REGISTRATION_FEE_XCP = 0.5;

/** Measured off a real launch (PARTYKILLER, weight 2136): one input, three
 *  multisig data outputs, one change output. The old 200 treated this as a
 *  plain transfer, which it isn't — the data outputs are most of the tx. */
const LAUNCH_TX_VBYTES_ESTIMATE = 534;

/** A launch is past the 80-byte OP_RETURN ceiling, so Counterparty encodes
 *  it as bare multisig: three outputs holding 1,000 sats each
 *  (DEFAULT_MULTISIG_DUST_SIZE). Recoverable, but it has to be in the wallet
 *  on the day — and omitting it is what let a funded wallet fail to
 *  compose. */
const LAUNCH_MULTISIG_DUST_SATS = 3_000;

type NameCheck =
  | "idle"
  | "checking"
  | "available"
  | "taken"
  | "owned"
  | "ineligible"
  | "invalid";

/**
 * Pre-announcement lead: minting opens this many blocks after compose time.
 * The standard requires only that the launch confirms strictly before
 * start_block — a launch that confirms late opens instantly and fails
 * conformance — so 36 blocks (~6 hours) is the shortest PRESET: comfortable
 * headroom at the ordinary next-block rate, and the default anyone gets
 * without thinking about it.
 *
 * Custom goes tighter (see CUSTOM_FLOOR_BLOCKS) and pays for it. Custom also
 * goes further out, for staggering a batch of launches across weeks — a
 * block, not a date, because the target is consensus state rather than a
 * wall-clock time this page can't actually promise.
 */
const PREANNOUNCE_FLOOR_BLOCKS = 36;
const PREANNOUNCE_PRESETS = [
  { id: "short", blocks: 36, label: "~6 hours" },
  { id: "day", blocks: 144, label: "~1 day" },
  { id: "week", blocks: 1008, label: "~7 days" },
] as const;
type PreannounceOption = (typeof PREANNOUNCE_PRESETS)[number]["id"] | "custom";

/**
 * Custom goes tighter than the presets do: ~1 hour, not ~6.
 *
 * The constraint is real but it is a FEE problem, not a time problem. The
 * launch has to confirm before its own start_block — a launch that confirms
 * after it opens the mint instantly and fails the standard — and at six
 * blocks of headroom the ordinary next-block rate no longer has room to be
 * wrong. Rather than forbid the tight end, the tight end pays for the
 * certainty it needs.
 */
const CUSTOM_FLOOR_BLOCKS = 6;

/** ~2 hours. At or under this lead the launch pays double the next-block
 *  rate: three to six blocks of slack cannot absorb a fee estimate that
 *  came in low, and the cost of being wrong is the launch itself. */
const TIGHT_LEAD_BLOCKS = 12;
const TIGHT_LEAD_FEE_MULTIPLIER = 2;

/** ~10 min/block, the same average the rest of the app assumes. Rough on
 *  purpose — the UI beside this always says "estimate," never "at". */
function estimateFromBlocks(blocksFromNow: number): string {
  if (blocksFromNow <= 0) return "not far enough in the future";
  const minutes = blocksFromNow * 10;
  if (minutes < 90) return `~${minutes} minutes`;
  const hours = minutes / 60;
  if (hours < 48) return `~${Math.round(hours)} hours`;
  return `~${Math.round(hours / 24)} days`;
}

const INSCRIBE_STEP_LABELS: Record<InscribeStep, string> = {
  preparing: "Preparing inscription…",
  "sign-commit": "Confirm commit in wallet…",
  "broadcast-commit": "Broadcasting commit…",
  "sign-reveal": "Confirm reveal in wallet…",
  "broadcast-reveal": "Broadcasting reveal…",
  done: "Done",
};

const inputClass =
  "mt-1 block w-full rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm outline-none transition-colors focus:border-purple-500 focus:bg-white";

export default function CreatePage() {
  const { address, status: walletStatus, signPsbt, broadcastTransaction } = useWallet();
  const compose = useCompose();
  const isTaproot = address?.startsWith("bc1p") ?? false;
  const [inscribe, setInscribe] = useState(false);
  const [inscribeStep, setInscribeStep] = useState<InscribeStep | null>(null);
  const [inscribeTxid, setInscribeTxid] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [nameCheck, setNameCheck] = useState<NameCheck>("idle");
  const [image, setImage] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [xProfile, setXProfile] = useState("");
  const [telegram, setTelegram] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scheduledStart, setScheduledStart] = useState<number | null>(null);
  const [scheduledLabel, setScheduledLabel] = useState<string | null>(null);

  // Advanced, tucked behind the gear — the default (shortest preset) never
  // needs a second thought; Custom exists for staggering a batch of launches
  // across a specific future date rather than picking from three buckets.
  const [preannounceOption, setPreannounceOption] = useState<PreannounceOption>("short");
  const [customBlockInput, setCustomBlockInput] = useState("");

  const [ineligibleReason, setIneligibleReason] = useState<string | null>(null);

  // What this launch will actually cost, before the wallet ever asks —
  // the same "receipt above the button" grammar the swap and dispense
  // forms already use. Next-block rate, not the median: this is a single
  // small transaction that has to confirm before the fixed pre-announcement
  // window elapses, so the estimate shown here is exactly what gets paid.
  const { data: feeRate } = useSWR("btc-feerate-priority", fetchPriorityFeeRate, {
    refreshInterval: 60_000,
  });
  const { data: btcUsd } = useSWR("btc-usd", fetchBtcUsd, { refreshInterval: 60_000 });
  const { data: xcpUsd } = useSWR("xcp-usd", fetchXcpUsd, { refreshInterval: 60_000 });
  const { data: blockHeight } = useSWR(
    "block-height",
    async () => {
      const res = await fetch(`${COUNTERPARTY_API_BASE}/`);
      return (await res.json()).result.counterparty_height as number;
    },
    { refreshInterval: 30_000 },
  );
  // Default to the standard fee — true for almost everyone — rather than a
  // blank dash until a name's been typed and checked; the one case it isn't
  // owed (you already registered this exact name) is the only one that
  // clears it.
  const registrationFeeXcp = nameCheck === "owned" ? 0 : REGISTRATION_FEE_XCP;

  const customBlockNum = Math.round(parseFloat(customBlockInput)) || 0;
  const minCustomBlock =
    blockHeight !== undefined ? blockHeight + CUSTOM_FLOOR_BLOCKS : undefined;
  const scheduleValid =
    preannounceOption !== "custom" ||
    (minCustomBlock !== undefined && customBlockNum >= minCustomBlock);

  // A registered name you OWN is launchable if it meets the consensus
  // preconditions: zero supply, unlocked, divisible.
  const checkName = async (value: string) => {
    if (!ASSET_NAME_REGEX.test(value)) {
      setNameCheck(value ? "invalid" : "idle");
      return;
    }
    setNameCheck("checking");
    setIneligibleReason(null);
    try {
      const res = await fetch(`${COUNTERPARTY_API_BASE}/assets/${value}`);
      const data = res.ok ? await res.json() : { result: null };
      const a = data.result;
      if (!a) {
        setNameCheck("available");
      } else if (address && a.owner === address) {
        if (a.locked) {
          setNameCheck("ineligible");
          setIneligibleReason("its issuance is locked, which can never be undone");
        } else if ((a.supply ?? 0) > 0) {
          setNameCheck("ineligible");
          setIneligibleReason(
            "it has circulating supply — every unit must be destroyed first",
          );
        } else if (a.divisible === false) {
          setNameCheck("ineligible");
          setIneligibleReason("it is indivisible; XCP-69 assets are divisible");
        } else {
          setNameCheck("owned");
        }
      } else {
        setNameCheck("taken");
      }
    } catch {
      setNameCheck("idle");
    }
  };

  const handleNameChange = (value: string) => {
    const upper = value.toUpperCase().replace(/[^A-Z]/g, "");
    setName(upper);
    setNameCheck("idle");
  };

  const imageTooBigToInscribe = inscribe && image !== null && image.size > INSCRIBE_MAX_BYTES;
  const canSubmit =
    (nameCheck === "available" || nameCheck === "owned") &&
    image !== null &&
    !imageTooBigToInscribe &&
    isValidX(xProfile) &&
    isValidTelegram(telegram) &&
    scheduleValid &&
    walletStatus === "connected" &&
    !submitting &&
    compose.status !== "composing" &&
    compose.status !== "signing" &&
    compose.status !== "broadcasting";

  const handleLaunch = async () => {
    if (!canSubmit || !image) return;
    setSubmitting(true);
    setUploadError(null);
    try {
      // 1. Host image + metadata JSON (write-once) so the on-chain
      //    description URL resolves from the first block.
      const form = new FormData();
      form.set("asset", name);
      form.set("description", description);
      form.set("x", xProfile);
      form.set("telegram", telegram);
      form.set("image", image);
      const uploadRes = await fetch("/api/launches", { method: "POST", body: form });
      const upload = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(upload.error ?? "Upload failed");

      // 2. Schedule: minting opens after the pre-announcement lead (a preset
      //    from now, or an exact future block for Custom), and the window is
      //    exactly the standard's 1,000 blocks from that start.
      const heightRes = await fetch(`${COUNTERPARTY_API_BASE}/`);
      const height = (await heightRes.json()).result.counterparty_height as number;
      const preset = PREANNOUNCE_PRESETS.find((p) => p.id === preannounceOption);
      const startBlock =
        preannounceOption === "custom"
          ? customBlockNum
          : height + (preset?.blocks ?? PREANNOUNCE_FLOOR_BLOCKS);
      setScheduledStart(startBlock);
      setScheduledLabel(preset ? preset.label : estimateFromBlocks(startBlock - height));

      // Next-block rate: this is a single small transaction, always worth
      // paying to confirm promptly rather than risk it lingering.
      //
      // Doubled at the tight end. With only a few blocks between broadcast
      // and start_block there is no room to re-fee: a launch that confirms
      // after its own start opens the mint instantly and fails the standard.
      // The multiplier buys the confirmation the schedule depends on, and it
      // only applies to a lead the creator chose knowing the price.
      const baseFeeRate = await fetchPriorityFeeRate();
      const submitFeeRate =
        startBlock - height <= TIGHT_LEAD_BLOCKS
          ? baseFeeRate * TIGHT_LEAD_FEE_MULTIPLIER
          : baseFeeRate;

      if (inscribe && isTaproot && address) {
        // 3a. Commit/reveal inscription: the image becomes the permanent
        //     on-chain description; the inscription output is burned.
        const { revealTxid } = await inscribeLaunch({
          asset: name,
          lpAsset: generateLpAssetName(),
          startBlock,
          softCapDeadlineBlock: startBlock + XCP69.DEADLINE_BLOCKS,
          jsonUrl: upload.json_url,
          imageData: new Uint8Array(await image.arrayBuffer()),
          mimeType: image.type,
          feeRate: submitFeeRate,
          address,
          signPsbt,
          broadcast: broadcastTransaction,
          onStep: setInscribeStep,
        });
        setInscribeTxid(revealTxid);
        return;
      }

      // 3b. Standard compose → sign → broadcast through the wallet.
      // The exact constants, not the doubles: HARD_CAP is 10^16, above the
      // range where a number identifies a single integer. It happens to print
      // its true digits today, but a launch's terms are not a thing to leave
      // resting on that.
      compose.composeFairminter({
        asset: name,
        price: XCP69_EXACT.PRICE,
        quantity_by_price: XCP69_EXACT.QUANTITY_BY_PRICE,
        hard_cap: XCP69_EXACT.HARD_CAP,
        soft_cap: XCP69_EXACT.SOFT_CAP,
        start_block: startBlock,
        soft_cap_deadline_block: startBlock + XCP69.DEADLINE_BLOCKS,
        max_mint_per_tx: XCP69_EXACT.MAX_MINT_PER_TX,
        max_mint_per_address: XCP69_EXACT.MAX_MINT_PER_ADDRESS,
        pool_quantity: XCP69_EXACT.POOL_QUANTITY,
        lp_asset: generateLpAssetName(),
        description: upload.json_url,
        fee_rate: submitFeeRate,
      });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Something went wrong");
      setInscribeStep(null);
    } finally {
      setSubmitting(false);
    }
  };

  const launchTxid = compose.status === "confirmed" ? compose.txid : inscribeTxid;

  // Covers both routes to a launch — the standard compose and the inscribed
  // one — because launchTxid is whichever of them produced a broadcast. Must
  // sit above the early return below: hooks cannot run conditionally.
  useEffect(() => {
    if (!launchTxid) return;
    // What the launch actually cost: the name registration. Zero when the
    // creator already owned the name, which reports as a conversion with no
    // revenue rather than an invented one.
    trackTx(
      launchTxid,
      "launch created",
      xcpUsd && registrationFeeXcp > 0 ? registrationFeeXcp * xcpUsd : null,
    );
  }, [launchTxid, registrationFeeXcp, xcpUsd]);

  if (launchTxid) {
    return (
      <div className="mx-auto max-w-lg space-y-4 text-center">
        <div className="holo-border rounded-xl p-8">
          <h1 className="text-2xl font-bold">{name} is scheduled.</h1>
          <p className="mt-2 text-sm text-gray-600">
            Broadcast as{" "}
            <a
              href={`https://xcp.io/tx/${launchTxid}`}
              className="font-mono text-purple-600 underline"
              target="_blank"
              rel="noreferrer"
            >
              {launchTxid.slice(0, 12)}…
            </a>
            . Minting opens at block{" "}
            <span className="font-mono font-medium text-gray-900">
              {scheduledStart?.toLocaleString()}
            </span>{" "}
            ({scheduledLabel}) — until then the launch is announced on-chain and
            nobody, you included, can mint. Then it runs for 1,000 blocks (~7
            days): it sells out, or everyone is refunded.
          </p>
          <ViewLaunchLink asset={name} />
        </div>
      </div>
    );
  }

  const buttonLabel =
    inscribeStep && inscribeStep !== "done"
      ? INSCRIBE_STEP_LABELS[inscribeStep]
      : compose.status === "composing"
        ? "Composing…"
        : compose.status === "signing"
          ? "Confirm in wallet…"
          : compose.status === "broadcasting"
            ? "Broadcasting…"
            : `Launch ${name || "token"}`;

  return (
    <div className="mx-auto max-w-4xl">
      {/* Two columns from `md`, not `lg`. The sidebar is the launch preview —
          the thing that shows what you're about to publish — and it was
          dropping to a full-width block below 1024px on windows that had
          plenty of room for it. At 768px the rail takes 17rem and still
          leaves the form ~27rem, which is wider than the form needs; it
          widens to 20rem once there's genuinely space. */}
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_17rem] md:gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
        {/* items-stretch (the grid default) is deliberate here: the right
            cell must be as tall as the form for the sticky preview to have
            room to travel and settle at the viewport's vertical center as
            you scroll — with items-start it has nowhere to go. */}
        <div className="rounded-3xl border border-gray-200 bg-white p-6 sm:p-7">
          <h1 className="text-2xl font-bold">Launch a token</h1>
          <p className="mt-1 text-sm text-gray-600">
            Name, image, description. Everything else is the standard.
          </p>

          {/* Name — on Counterparty the asset name is the ticker; one identity */}
          <div className="mt-6">
            <label htmlFor="asset-name" className="text-sm font-medium text-gray-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="asset-name"
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              onBlur={() => checkName(name)}
              placeholder="PEPECOIN"
              maxLength={12}
              className={`${inputClass} font-mono uppercase`}
            />
            <p className="mt-1 text-xs text-gray-500">
              {nameCheck === "invalid" &&
                "4-12 letters A-Z, cannot start with A (named assets only)."}
              {nameCheck === "checking" && "Checking availability…"}
              {nameCheck === "available" && (
                <span className="text-green-600">
                  {name} is available (0.5 XCP registration fee applies —{" "}
                  <Link href="/dispense" className="underline">
                    need XCP?
                  </Link>
                  ).
                </span>
              )}
              {nameCheck === "owned" && (
                <span className="text-green-700">
                  {name} is yours — this launch reuses your registered name (no
                  registration fee). If the launch fails, the name locks at zero
                  supply forever.
                </span>
              )}
              {nameCheck === "ineligible" && (
                <span className="text-red-600">
                  You own {name}, but {ineligibleReason}.
                </span>
              )}
              {nameCheck === "taken" && (
                <span className="text-red-600">
                  {name} is already registered.
                  {walletStatus !== "connected" &&
                    " If it's yours, connect that wallet to launch with it."}
                </span>
              )}
              {nameCheck === "idle" &&
                "The on-chain asset name — universally unique, can never change."}
            </p>
          </div>

          {/* Image */}
          <div className="mt-5">
            <label htmlFor="token-image" className="text-sm font-medium text-gray-700">
              Image <span className="text-red-500">*</span>
            </label>
            <div className="relative mt-1 flex min-h-32 items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-4 hover:border-purple-400">
              <input
                id="token-image"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => setImage(e.target.files?.[0] ?? null)}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label="Upload token image"
              />
              {image ? (
                <div className="flex items-center gap-3 text-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={URL.createObjectURL(image)}
                    alt=""
                    className="size-16 rounded-full object-cover"
                  />
                  <div>
                    <div className="font-medium">{image.name}</div>
                    <div className="text-xs text-gray-500">
                      {(image.size / 1024).toFixed(0)} KB · click to replace
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-sm text-gray-500">
                  <div className="font-medium text-gray-700">
                    Select an image or drag and drop it here
                  </div>
                  <div className="mt-1 text-xs">
                    PNG, JPEG, WEBP or GIF ·{" "}
                    {inscribe ? "max 385 KB (inscribing)" : "max 2 MB"} · square
                    (1:1) recommended
                  </div>
                </div>
              )}
            </div>
            {isTaproot && (
              <label className="mt-3 flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={inscribe}
                  onChange={(e) => setInscribe(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Inscribe the image on-chain.</span>{" "}
                  <span className="text-xs text-gray-500">
                    The image itself becomes the permanent on-chain description
                    (commit + reveal, two signatures, higher fees scale with image
                    size; the inscription is burned so it belongs to the asset
                    forever). Max 385 KB. Taproot wallets only.
                  </span>
                  {imageTooBigToInscribe && (
                    <span className="mt-1 block text-xs text-red-600">
                      This image is {(image!.size / 1024).toFixed(0)} KB — inscribing
                      caps at 385 KB. Use a smaller file or uncheck to host it instead.
                    </span>
                  )}
                </span>
              </label>
            )}
          </div>

          {/* Description */}
          <div className="mt-5">
            <label htmlFor="token-description" className="text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id="token-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What is this?"
              className={inputClass}
            />
          </div>

          {/* Socials — we collect two URLs; there's nothing here worth
              hiding behind a disclosure. */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <SocialInput
              id="x-profile"
              label="X profile"
              placeholder="https://x.com/yourtoken"
              value={xProfile}
              onChange={setXProfile}
              validate={isValidX}
            />
            <SocialInput
              id="telegram"
              label="Telegram"
              placeholder="https://t.me/yourtoken"
              value={telegram}
              onChange={setTelegram}
              validate={isValidTelegram}
            />
          </div>

          {/* The due line — what pressing the button actually costs,
              stated before it's asked for, same grammar as swap/dispense. */}
          <div className="mt-5 border-t border-gray-100 pt-4">
            <dl className="space-y-1.5 text-xs text-gray-500">
              <div className="flex justify-between">
                <dt>Counterparty</dt>
                <dd className="font-medium tabular-nums text-gray-700">
                  {registrationFeeXcp > 0
                    ? `${registrationFeeXcp} XCP${
                        xcpUsd ? ` (${usd(registrationFeeXcp * xcpUsd)})` : ""
                      }`
                    : nameCheck === "owned"
                      ? "none — you already own this name"
                      : "—"}
                </dd>
              </div>
              {feeRate !== undefined && (
                <div className="flex justify-between">
                  <dt>Bitcoin tx fee</dt>
                  <dd className="tabular-nums text-gray-700">
                    {commas(feeRate * LAUNCH_TX_VBYTES_ESTIMATE + LAUNCH_MULTISIG_DUST_SATS)}{" "}
                    sats
                    {btcUsd !== null && btcUsd !== undefined && (
                      <span className="text-gray-400">
                        {" "}
                        (~
                        {usd(
                          ((feeRate * LAUNCH_TX_VBYTES_ESTIMATE +
                            LAUNCH_MULTISIG_DUST_SATS) /
                            SATS) *
                            btcUsd,
                        )}
                        )
                      </span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {uploadError && (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {uploadError}
            </p>
          )}
          {compose.status === "error" && (
            <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {compose.error}
            </p>
          )}

          <div className="mt-5">
            {walletStatus !== "connected" ? (
              <ConnectButton className="w-full" />
            ) : (
              <CTA onClick={handleLaunch} disabled={!canSubmit}>
                {buttonLabel}
              </CTA>
            )}
          </div>
        </div>

        {/* Live preview — the token as it'll actually look, plus the
            terms worth seeing before you sign rather than the full fixed
            list every launch already shares. */}
        <div className="mt-6 md:mt-0">
          <PreviewCard
            name={name}
            image={image}
            description={description}
            nameCheck={nameCheck}
            preannounceOption={preannounceOption}
            onPreannounceOptionChange={setPreannounceOption}
            customBlockInput={customBlockInput}
            onCustomBlockChange={setCustomBlockInput}
            blockHeight={blockHeight}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewCard({
  name,
  image,
  description,
  nameCheck,
  preannounceOption,
  onPreannounceOptionChange,
  customBlockInput,
  onCustomBlockChange,
  blockHeight,
}: {
  name: string;
  image: File | null;
  description: string;
  nameCheck: NameCheck;
  preannounceOption: PreannounceOption;
  onPreannounceOptionChange: (o: PreannounceOption) => void;
  customBlockInput: string;
  onCustomBlockChange: (v: string) => void;
  blockHeight: number | undefined;
}) {
  const customBlockNum = Math.round(parseFloat(customBlockInput)) || 0;
  const priceXcp = XCP69.PRICE / SATS;
  const lot = XCP69.QUANTITY_BY_PRICE / SATS;
  const targetXcp = fromSats(XCP69_RAISE_SATS);
  const supplyTokens = fromSats(XCP69.HARD_CAP);
  const statusLabel: Record<NameCheck, string> = {
    idle: "on-chain asset name",
    checking: "checking…",
    available: "available",
    owned: "yours — reused, no fee",
    taken: "already registered",
    ineligible: "not launchable",
    invalid: "4-12 letters, A-Z",
  };
  const statusTone: Record<NameCheck, string> = {
    idle: "text-gray-400",
    checking: "text-gray-400",
    available: "text-green-600",
    owned: "text-green-700",
    taken: "text-red-600",
    ineligible: "text-red-600",
    invalid: "text-gray-400",
  };

  return (
    <div className="md:sticky md:top-1/2 md:-translate-y-1/2 rounded-3xl border border-gray-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={URL.createObjectURL(image)}
              alt=""
              className="size-14 shrink-0 rounded-2xl bg-gray-200 object-cover"
            />
          ) : (
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gray-200 text-lg font-bold text-gray-400">
              {name.slice(0, 1) || "?"}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-lg font-bold leading-tight">
              {name || "YOURTOKEN"}
            </div>
            <div className={`text-xs font-medium ${statusTone[nameCheck]}`}>
              {statusLabel[nameCheck]}
            </div>
          </div>
        </div>
        {/* Advanced, and detached from any one fact below — this is a
            setting for the launch, not an attribute of it. */}
        <ScheduleGear
          option={preannounceOption}
          onOptionChange={onPreannounceOptionChange}
          customBlock={customBlockInput}
          onCustomBlockChange={onCustomBlockChange}
          blockHeight={blockHeight}
        />
      </div>

      {description && (
        <p className="mt-3 line-clamp-3 text-sm text-gray-600">{description}</p>
      )}

      {/* Touchstone facts only — what it costs, what the goal is, whether
          it's safe, and when it starts. Supply, the mint window's exact
          length, and the minimum-community floor are all true but not
          decision-relevant the way these four are; they live in the docs. */}
      <dl className="mt-4 space-y-2 border-t border-gray-200 pt-4 text-xs">
        <Row k="Supply" v={commas(supplyTokens)} />
        <Row k="Price" v={`${priceXcp} XCP / ${commas(lot)}`} />
        <Row k="Target" v={`${commas(targetXcp)} XCP or refund`} />
        <Row k="Liquidity" v="locked forever, LP burned" />
        <Row
          k="Minting opens"
          v={
            preannounceOption === "custom"
              ? customBlockInput
                ? `block ${commas(customBlockNum)}`
                : "custom block"
              : (PREANNOUNCE_PRESETS.find((p) => p.id === preannounceOption)
                  ?.label ?? "")
          }
        />
      </dl>
    </div>
  );
}

/** The gear beside "Minting opens" — presets cover it for everyone else;
 *  Custom exists for staggering a batch of launches across specific future
 *  blocks (e.g. one per day for a couple months). */
function ScheduleGear({
  option,
  onOptionChange,
  customBlock,
  onCustomBlockChange,
  blockHeight,
}: {
  option: PreannounceOption;
  onOptionChange: (o: PreannounceOption) => void;
  customBlock: string;
  onCustomBlockChange: (v: string) => void;
  blockHeight: number | undefined;
}) {
  const customNum = Math.round(parseFloat(customBlock)) || 0;
  const minBlock =
    blockHeight !== undefined ? blockHeight + CUSTOM_FLOOR_BLOCKS : undefined;
  const tooSoon =
    option === "custom" &&
    customBlock !== "" &&
    minBlock !== undefined &&
    customNum < minBlock;
  // Priced before it's chosen, not discovered on the receipt.
  const tightLead =
    option === "custom" &&
    !tooSoon &&
    customBlock !== "" &&
    blockHeight !== undefined &&
    customNum - blockHeight <= TIGHT_LEAD_BLOCKS;

  return (
    <GearPopover active={option !== "short"} label="Launch timing" small>
      <div className="text-xs font-medium text-gray-500">Minting opens</div>
      <div className="mt-2 flex items-center gap-1.5">
        {PREANNOUNCE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOptionChange(p.id)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              option === p.id
                ? "border-purple-600 bg-purple-50 text-purple-700"
                : "border-gray-200 text-gray-600 hover:border-gray-300"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onOptionChange("custom")}
          className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
            option === "custom"
              ? "border-purple-600 bg-purple-50 text-purple-700"
              : "border-gray-200 text-gray-600 hover:border-gray-300"
          }`}
        >
          Custom
        </button>
      </div>
      {option === "custom" && (
        <div className="mt-3">
          <div
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 transition-colors focus-within:border-purple-400 ${
              tooSoon ? "border-red-400 bg-red-50" : "border-gray-200"
            }`}
          >
            <AmountInput
              value={customBlock}
              onChange={onCustomBlockChange}
              placeholder={minBlock ? String(minBlock) : "block height"}
              ariaLabel="Target start block"
              className="w-full bg-transparent text-xs font-medium outline-none"
            />
            <span className="text-xs text-gray-400">block</span>
          </div>
          {customBlock === "" ? (
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
              Any future block, {minBlock ? `${commas(minBlock)} or later` : "at least ~1 hour out"} —
              tighter than the presets go. Under ~2 hours pays double the
              network fee.
            </p>
          ) : tooSoon ? (
            <p className="mt-1.5 text-[11px] font-medium text-red-600">
              Too soon — needs to be block {minBlock ? commas(minBlock) : "…"} or
              later (~1 hour out). The launch has to confirm before it opens.
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
                ≈ {estimateFromBlocks(customNum - (blockHeight ?? customNum))} from
                now — an estimate, not a guarantee; block time isn&apos;t exact.
              </p>
              {tightLead && (
                <p className="mt-1.5 text-[11px] font-medium leading-relaxed text-amber-700">
                  Double network fee at this lead — there aren&apos;t enough
                  blocks to re-fee if the estimate comes in low, and a launch
                  that confirms after it opens fails the standard.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </GearPopover>
  );
}

function SocialInput({
  id,
  label,
  placeholder,
  value,
  onChange,
  validate,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  validate: (v: string) => boolean;
}) {
  const [touched, setTouched] = useState(false);
  const valid = validate(value);
  const showError = touched && !valid;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        placeholder={placeholder}
        className={`${inputClass} ${showError ? "border-red-400" : ""}`}
      />
      {showError && (
        <p className="mt-1 text-xs text-red-600">
          Paste the profile URL or enter the handle.
        </p>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{k}</dt>
      <dd className="text-right font-medium tabular-nums text-gray-900">{v}</dd>
    </div>
  );
}
