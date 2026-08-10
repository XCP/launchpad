"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { ConnectButton } from "@/components/connect-button";
import { CTA } from "@/components/ui/button";
import { fetchBtcUsd, fetchXcpUsd } from "@/lib/api/price";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { fromSats, commas, usd } from "@/lib/format";
import { inscribeLaunch, type InscribeStep } from "@/lib/inscribe-launch";
import { SATS } from "@/lib/numeric";
import { isValidSocial } from "@/lib/social";
import { fetchMedianFeeRate, useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import {
  generateLpAssetName,
  XCP69,
  XCP69_EXACT,
  XCP69_MIN_PARTICIPANTS,
  XCP69_RAISE_SATS,
} from "@/lib/xcp69";

const ASSET_NAME_REGEX = /^[B-Z][A-Z]{3,11}$/;

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

/** A fairminter compose is one input, one output, no special script —
 *  close enough to a plain transfer for the "how much will this cost"
 *  estimate this line exists to give, not an exact preview of the final
 *  composed size. */
const LAUNCH_TX_VBYTES_ESTIMATE = 200;

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
 * Fixed, not a choice — the standard requires only that the launch confirms
 * strictly before start_block, but a launch that confirms late opens
 * instantly and fails conformance. 36 blocks (~6 hours) leaves comfortable
 * headroom for confirmation at the ordinary median fee rate, so there's no
 * "tight lead" tier to warn about or pay a priority rate for.
 */
const PREANNOUNCE_BLOCKS = 36;

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

  const [ineligibleReason, setIneligibleReason] = useState<string | null>(null);

  // What this launch will actually cost, before the wallet ever asks —
  // the same "receipt above the button" grammar the swap and dispense
  // forms already use.
  const { data: medianFeeRate } = useSWR("btc-feerate", fetchMedianFeeRate, {
    refreshInterval: 60_000,
  });
  const { data: btcUsd } = useSWR("btc-usd", fetchBtcUsd, { refreshInterval: 60_000 });
  const { data: xcpUsd } = useSWR("xcp-usd", fetchXcpUsd, { refreshInterval: 60_000 });
  const registrationFeeXcp = nameCheck === "available" ? REGISTRATION_FEE_XCP : 0;

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
    isValidSocial(xProfile) &&
    isValidSocial(telegram) &&
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

      // 2. Schedule: minting opens after the pre-announcement lead, and the
      //    window is exactly the standard's 1,000 blocks from that start.
      const heightRes = await fetch(`${COUNTERPARTY_API_BASE}/`);
      const height = (await heightRes.json()).result.counterparty_height as number;
      const startBlock = height + PREANNOUNCE_BLOCKS;
      setScheduledStart(startBlock);

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
          feeRate: 2,
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
      });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Something went wrong");
      setInscribeStep(null);
    } finally {
      setSubmitting(false);
    }
  };

  const launchTxid = compose.status === "confirmed" ? compose.txid : inscribeTxid;
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
            (~6 hours) — until then the launch is announced on-chain and nobody, you
            included, can mint. Then it runs for 1,000 blocks (~7 days): it
            sells out, or everyone is refunded.
          </p>
          <a
            href={`/${name}`}
            className="mt-6 inline-block rounded-md bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700"
          >
            View launch page
          </a>
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
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6">
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
            />
            <SocialInput
              id="telegram"
              label="Telegram"
              placeholder="https://t.me/yourtoken"
              value={telegram}
              onChange={setTelegram}
            />
          </div>

          {/* Pre-announcement — fixed, not a choice */}
          <div className="mt-5">
            <p className="text-sm font-medium text-gray-700">Minting opens in ~6 hours</p>
            <p className="mt-1 text-xs text-gray-500">
              Announced on-chain first — nobody, creator included, can mint
              early.
            </p>
          </div>

          {/* The due line — what pressing the button actually costs,
              stated before it's asked for, same grammar as swap/dispense. */}
          <div className="mt-5 border-t border-gray-100 pt-4">
            <dl className="space-y-1.5 text-xs text-gray-500">
              <div className="flex justify-between">
                <dt>Registration fee</dt>
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
              {medianFeeRate !== undefined && (
                <div className="flex justify-between">
                  <dt>Network fee (est.)</dt>
                  <dd className="tabular-nums text-gray-700">
                    {medianFeeRate} sat/vB
                    {btcUsd !== null && btcUsd !== undefined && (
                      <span className="text-gray-400">
                        {" "}
                        (~
                        {usd(
                          ((medianFeeRate * LAUNCH_TX_VBYTES_ESTIMATE) / SATS) * btcUsd,
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
        <div className="mt-6 lg:mt-0">
          <PreviewCard
            name={name}
            image={image}
            description={description}
            nameCheck={nameCheck}
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
}: {
  name: string;
  image: File | null;
  description: string;
  nameCheck: NameCheck;
}) {
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
    <div className="lg:sticky lg:top-1/2 lg:-translate-y-1/2 rounded-3xl border border-gray-200 bg-gray-50 p-5">
      <div className="flex items-center gap-3">
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

      {description && (
        <p className="mt-3 line-clamp-3 text-sm text-gray-600">{description}</p>
      )}

      <dl className="mt-4 space-y-2 border-t border-gray-200 pt-4 text-xs">
        <Row k="Supply" v={`${commas(supplyTokens)} — locked at launch`} />
        <Row k="Price" v={`${priceXcp} XCP / ${commas(lot)}`} />
        <Row k="Target" v={`${commas(targetXcp)} XCP or refund`} />
        <Row k="Window" v="1,000 blocks (~7 days)" />
        <Row k="Minimum community" v={`${XCP69_MIN_PARTICIPANTS}+ addresses`} />
        <Row k="Liquidity" v="locked forever, LP burned" />
      </dl>
    </div>
  );
}

function SocialInput({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [touched, setTouched] = useState(false);
  const valid = isValidSocial(value);
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
