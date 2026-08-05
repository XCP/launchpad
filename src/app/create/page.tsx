"use client";

import { useState } from "react";
import { COUNTERPARTY_API_BASE } from "@/utils/constants";
import { fromSats, commas } from "@/lib/format";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import {
  generateLpAssetName,
  XCP69,
  XCP69_MIN_PARTICIPANTS,
  XCP69_OPENING_MULTIPLE,
  XCP69_RAISE_SATS,
} from "@/lib/xcp69";

const ASSET_NAME_REGEX = /^[B-Z][A-Z]{3,11}$/;

type NameCheck = "idle" | "checking" | "available" | "taken" | "invalid";

export default function CreatePage() {
  const { address, status: walletStatus, connect } = useWallet();
  const compose = useCompose();

  const [name, setName] = useState("");
  const [nameCheck, setNameCheck] = useState<NameCheck>("idle");
  const [image, setImage] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [xProfile, setXProfile] = useState("");
  const [telegram, setTelegram] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  const canSubmit =
    nameCheck === "available" &&
    image !== null &&
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

      // 2. Deadline = current block + the standard's 1,000-block window.
      const heightRes = await fetch(`${COUNTERPARTY_API_BASE}/`);
      const height = (await heightRes.json()).result.counterparty_height as number;

      // 3. Compose → sign → broadcast through the wallet.
      compose.composeFairminter({
        asset: name,
        price: XCP69.PRICE,
        quantity_by_price: XCP69.QUANTITY_BY_PRICE,
        hard_cap: XCP69.HARD_CAP,
        soft_cap: XCP69.SOFT_CAP,
        soft_cap_deadline_block: height + XCP69.DEADLINE_BLOCKS,
        max_mint_per_tx: XCP69.MAX_MINT_PER_TX,
        max_mint_per_address: XCP69.MAX_MINT_PER_ADDRESS,
        pool_quantity: XCP69.POOL_QUANTITY,
        lp_asset: generateLpAssetName(),
        description: upload.json_url,
      });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  if (compose.status === "confirmed") {
    return (
      <div className="mx-auto max-w-lg space-y-4 text-center">
        <div className="holo-border rounded-xl p-8">
          <h1 className="text-2xl font-bold">{name} is launching.</h1>
          <p className="mt-2 text-sm text-gray-600">
            Broadcast as{" "}
            <a
              href={`https://xcp.io/tx/${compose.txid}`}
              className="font-mono text-purple-600 underline"
              target="_blank"
              rel="noreferrer"
            >
              {compose.txid.slice(0, 12)}…
            </a>
            . Once confirmed, minting is open for ~7 days: it sells out, or
            everyone is refunded.
          </p>
          <a
            href={`/launch/${name}`}
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
              {name} is available (0.5 XCP registration fee applies).
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
        <input
          id="token-image"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => setImage(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-gray-700"
        />
        <p className="mt-1 text-xs text-gray-500">
          PNG, JPEG, WEBP or GIF, max 2 MB. Hosted with your token&apos;s metadata;
          the on-chain description locks to it forever.
        </p>
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

      {/* Socials */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="x-profile" className="text-sm font-medium text-gray-700">
            X profile
          </label>
          <div className="mt-1 flex items-center rounded-md border border-gray-300 bg-white focus-within:border-purple-500">
            <span className="pl-2.5 text-sm text-gray-400">x.com/</span>
            <input
              id="x-profile"
              type="text"
              value={xProfile}
              onChange={(e) => setXProfile(e.target.value)}
              placeholder="handle"
              className="w-full rounded-md bg-transparent p-2.5 pl-0.5 text-sm outline-none"
            />
          </div>
        </div>
        <div>
          <label htmlFor="telegram" className="text-sm font-medium text-gray-700">
            Telegram
          </label>
          <div className="mt-1 flex items-center rounded-md border border-gray-300 bg-white focus-within:border-purple-500">
            <span className="pl-2.5 text-sm text-gray-400">t.me/</span>
            <input
              id="telegram"
              type="text"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="community"
              className="w-full rounded-md bg-transparent p-2.5 pl-0.5 text-sm outline-none"
            />
          </div>
        </div>
      </div>

      {/* The terms — fixed by the standard, shown, not asked */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm">
        <div className="mb-2 font-semibold">XCP-69 terms (fixed)</div>
        <dl className="space-y-1 text-gray-600">
          <Row k="Supply" v="100,000,000 — locked at launch" />
          <Row k="Public sale" v="69,000,000 at 0.1 XCP per 1,000" />
          <Row
            k="Per address"
            v={`max ${commas(fromSats(XCP69.MAX_MINT_PER_ADDRESS))} (1% · 69 XCP)`}
          />
          <Row k="Window" v="1,000 blocks (~7 days), sells out or refunds" />
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
          {compose.status === "composing" && "Composing…"}
          {compose.status === "signing" && "Confirm in wallet…"}
          {compose.status === "broadcasting" && "Broadcasting…"}
          {(compose.status === "idle" || compose.status === "error") &&
            `Launch ${name || "token"} from ${address?.slice(0, 8)}…`}
        </button>
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
