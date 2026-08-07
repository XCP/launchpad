"use client";

import Link from "next/link";
import { useState } from "react";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { fromSats, commas } from "@/lib/format";
import { inscribeLaunch, type InscribeStep } from "@/lib/inscribe-launch";
import { isValidSocial } from "@/lib/social";
import { fetchPriorityFeeRate, useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import {
  generateLpAssetName,
  XCP69,
  XCP69_EXACT,
  XCP69_MIN_PARTICIPANTS,
  XCP69_OPENING_MULTIPLE,
  XCP69_RAISE_SATS,
} from "@/lib/xcp69";

const ASSET_NAME_REGEX = /^[B-Z][A-Z]{3,11}$/;

/**
 * Inscribed images live in the reveal witness; Bitcoin's 400k-weight
 * standardness ceiling puts the practical content limit around 400 KB.
 */
const INSCRIBE_MAX_BYTES = 400 * 1024;

type NameCheck = "idle" | "checking" | "available" | "taken" | "invalid";

/**
 * Pre-announcement lead: minting opens this many blocks after compose time.
 * The standard requires only that the launch confirms strictly before
 * start_block — but a launch that confirms late opens instantly and fails
 * conformance, so the shortest option still leaves hours of headroom for
 * the transaction to confirm.
 */
const PREANNOUNCE_OPTIONS: { blocks: number; label: string; priority?: boolean }[] = [
  { blocks: 1, label: "next block (~10 min)", priority: true },
  { blocks: 6, label: "~1 hour", priority: true },
  { blocks: 36, label: "~6 hours" },
  { blocks: 144, label: "~1 day" },
  { blocks: 432, label: "~3 days" },
];
const PREANNOUNCE_DEFAULT = 36;

const INSCRIBE_STEP_LABELS: Record<InscribeStep, string> = {
  preparing: "Preparing inscription…",
  "sign-commit": "Confirm commit in wallet…",
  "broadcast-commit": "Broadcasting commit…",
  "sign-reveal": "Confirm reveal in wallet…",
  "broadcast-reveal": "Broadcasting reveal…",
  done: "Done",
};

export default function CreatePage() {
  const { address, status: walletStatus, connect, signPsbt, broadcastTransaction } = useWallet();
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
  const [preannounce, setPreannounce] = useState(PREANNOUNCE_DEFAULT);
  const [scheduledStart, setScheduledStart] = useState<number | null>(null);

  const checkName = async (value: string) => {
    if (!ASSET_NAME_REGEX.test(value)) {
      setNameCheck(value ? "invalid" : "idle");
      return;
    }
    setNameCheck("checking");
    try {
      const res = await fetch(`${COUNTERPARTY_API_BASE}/assets/${value}`);
      const data = res.ok ? await res.json() : { result: null };
      setNameCheck(data.result ? "taken" : "available");
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
    nameCheck === "available" &&
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
      const startBlock = height + preannounce;
      setScheduledStart(startBlock);

      // Tight leads leave little room for a slow confirmation — a launch
      // confirming after its start block opens instantly and fails the
      // standard. Pay the next-block rate so that can't happen.
      const isPriority = PREANNOUNCE_OPTIONS.find(
        (o) => o.blocks === preannounce,
      )?.priority;
      const feeRate = isPriority ? await fetchPriorityFeeRate() : undefined;

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
          feeRate: feeRate ?? 2,
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
        ...(feeRate ? { fee_rate: feeRate } : {}),
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
            (
            {PREANNOUNCE_OPTIONS.find((o) => o.blocks === preannounce)?.label ??
              `~${preannounce} blocks`}
            ) — until then the launch is announced on-chain and nobody, you
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

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Launch a token</h1>
        <p className="mt-1 text-sm text-gray-600">
          Name, image, description. Everything else is the standard.
        </p>
      </div>

      {/* Name — on Counterparty the asset name is the ticker; one identity */}
      <div>
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
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2.5 font-mono uppercase outline-none focus:border-purple-500"
        />
        <p className="mt-1 text-xs text-gray-500">
          {nameCheck === "invalid" &&
            "4-12 letters A-Z, cannot start with A (named assets only)."}
          {nameCheck === "checking" && "Checking availability…"}
          {nameCheck === "available" && (
            <span className="text-green-600">
              {name} is available (0.5 XCP registration fee applies —{" "}
              <Link href="/xcp" className="underline">
                need XCP?
              </Link>
              ).
            </span>
          )}
          {nameCheck === "taken" && (
            <span className="text-red-600">{name} is already registered.</span>
          )}
          {nameCheck === "idle" &&
            "The on-chain asset name — universally unique, can never change."}
        </p>
      </div>

      {/* Image */}
      <div>
        <label htmlFor="token-image" className="text-sm font-medium text-gray-700">
          Image <span className="text-red-500">*</span>
        </label>
        <div className="relative mt-1 flex min-h-32 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-white p-4 hover:border-purple-400">
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
                PNG, JPEG, WEBP or GIF · max 2 MB · square (1:1) recommended
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
                forever). Max 400 KB. Taproot wallets only.
              </span>
              {imageTooBigToInscribe && (
                <span className="mt-1 block text-xs text-red-600">
                  This image is {(image!.size / 1024).toFixed(0)} KB — inscribing
                  caps at 400 KB. Use a smaller file or uncheck to host it instead.
                </span>
              )}
            </span>
          </label>
        )}
      </div>

      {/* Description */}
      <div>
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
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2.5 text-sm outline-none focus:border-purple-500"
        />
      </div>

      {/* Socials — optional, tucked away */}
      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-gray-700 marker:content-none">
          <span className="text-purple-600">＋</span> Add social links{" "}
          <span className="font-normal text-gray-400">(optional)</span>
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
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
      </details>

      {/* Pre-announcement — the only knob the standard leaves open */}
      <div>
        <label htmlFor="preannounce" className="text-sm font-medium text-gray-700">
          Minting opens in
        </label>
        <select
          id="preannounce"
          value={preannounce}
          onChange={(e) => setPreannounce(Number(e.target.value))}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2.5 text-sm outline-none focus:border-purple-500"
        >
          {PREANNOUNCE_OPTIONS.map((o) => (
            <option key={o.blocks} value={o.blocks}>
              {o.label} ({o.blocks} blocks) after launch
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          Every XCP-69 launch is announced on-chain before minting opens —
          nobody, creator included, can mint early. The 1,000-block (~7 day)
          window starts when minting opens.
        </p>
        {PREANNOUNCE_OPTIONS.find((o) => o.blocks === preannounce)?.priority && (
          <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
            Tight lead: your launch transaction will pay mempool.space&apos;s
            next-block fee rate, because it must confirm before minting
            opens — a launch that confirms late opens instantly and fails
            the standard.
          </p>
        )}
      </div>

      {/* The terms — fixed by the standard, shown, not asked */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <div className="mb-2 font-semibold">XCP-69 terms (fixed)</div>
        <dl className="space-y-1 text-gray-600">
          <Row k="Supply" v="100,000,000 — locked at launch" />
          <Row k="Public sale" v="69,000,000 at 0.01 XCP per 1,000" />
          <Row
            k="Per address"
            v={`max ${commas(fromSats(XCP69.MAX_MINT_PER_ADDRESS))} (10 XCP)`}
          />
          <Row k="Window" v="1,000 blocks (~7 days) — sells out, or refunds within the week" />
          <Row
            k="You receive"
            v={`0 of the ${commas(fromSats(XCP69_RAISE_SATS))} XCP raised — all of it becomes pool liquidity, LP burned`}
          />
          <Row
            k="Pool opens"
            v={`31,000,000 tokens at ${XCP69_OPENING_MULTIPLE.toFixed(2)}× mint price`}
          />
          <Row k="Minimum community" v={`${XCP69_MIN_PARTICIPANTS} distinct addresses`} />
        </dl>
      </div>

      <p className="text-xs text-gray-500">
        The on-chain description locks at launch and can never change. It
        points at info this site hosts for you — and as the issuer you can
        edit that info later from the launch page with your wallet.
      </p>

      {uploadError && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {uploadError}
        </p>
      )}
      {compose.status === "error" && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {compose.error}
        </p>
      )}

      {walletStatus !== "connected" ? (
        <button
          type="button"
          onClick={() => connect()}
          className="w-full rounded-md bg-gray-900 px-5 py-3 font-medium text-white hover:bg-gray-700"
        >
          {walletStatus === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleLaunch}
          disabled={!canSubmit}
          className="w-full rounded-md bg-gray-900 px-5 py-3 font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {inscribeStep && inscribeStep !== "done"
            ? INSCRIBE_STEP_LABELS[inscribeStep]
            : compose.status === "composing"
              ? "Composing…"
              : compose.status === "signing"
                ? "Confirm in wallet…"
                : compose.status === "broadcasting"
                  ? "Broadcasting…"
                  : `Launch ${name || "token"} from ${address?.slice(0, 8)}…`}
        </button>
      )}
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
  const valid = isValidSocial(value);
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
        placeholder={placeholder}
        className={`mt-1 block w-full rounded-md border bg-white p-2.5 text-sm outline-none ${
          valid ? "border-gray-300 focus:border-purple-500" : "border-red-400"
        }`}
      />
      {!valid && (
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
      <dt className="shrink-0">{k}</dt>
      <dd className="text-right font-medium text-gray-900">{v}</dd>
    </div>
  );
}
