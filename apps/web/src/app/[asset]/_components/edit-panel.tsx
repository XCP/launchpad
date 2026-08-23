"use client";

import { useState } from "react";
import useSWR from "swr";
import { fileIsAnimatedWebp } from "@/lib/animated-webp";
import { fetchJson } from "@/lib/client";
import { fetchIndexedLaunch } from "@/lib/api/launchpad-api";
import { useSession } from "@/providers/session-context";
import { isValidTelegram, isValidX } from "@/lib/social";
import { useWallet } from "@/lib/wallet/wallet-context";
import { COUNTERPARTY_API_BASE } from "@/lib/constants";

/**
 * Owner-only metadata editing. The on-chain description URL is locked; the
 * hosted JSON behind it stays curatable by whoever owns the asset NOW.
 *
 * Ownership is read live rather than taken from the launch record: `source`
 * is who created the fairminter and never changes, while `owner` transfers,
 * so gating on the creator would both hide this from a new owner and offer it
 * to a former one who can only get a 403. The server re-checks the same live
 * owner and re-verifies the signature, so this gate is for display — with one
 * exception: a connection whose proof actively FAILED verification is refused
 * here, since that's the one state where the address itself is in doubt.
 */
export function EditPanel({ asset }: { asset: string }) {
  const { address, status: walletStatus, proofStatus, signMessage } = useWallet();
  const { address: sessionAddress } = useSession();
  const { data: owner } = useSWR<string | null>(
    walletStatus === "connected" ? [asset, "asset-owner"] : null,
    async () => {
      const info = (await fetchJson(`${COUNTERPARTY_API_BASE}/assets/${asset}`)).result as
        | { owner?: string; issuer?: string }
        | null;
      return info?.owner ?? info?.issuer ?? null;
    },
    { revalidateOnFocus: false },
  );
  const [loaded, setLoaded] = useState(false);
  const [description, setDescription] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [animatedWebp, setAnimatedWebp] = useState(false);
  const [state, setState] = useState<
    | { status: "idle" | "signing" | "saving" | "saved" }
    | { status: "error"; error: string }
  >({ status: "idle" });

  if (walletStatus !== "connected" || !owner || address !== owner) return null;

  if (proofStatus === "failed") {
    return (
      <div className="mt-4 rounded-3xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-semibold">Editing is locked for this session</p>
        <p className="mt-1 text-xs">
          Your wallet supplied a connection signature that didn&apos;t verify, so we
          can&apos;t confirm this address is really yours. Disconnect and reconnect to
          try again — nothing else on the site is affected.
        </p>
      </div>
    );
  }

  const prefill = async () => {
    if (loaded) return;
    setLoaded(true);
    try {
      const res = await fetch(`/j/${asset}.json`);
      if (res.ok) {
        const meta = await res.json();
        setDescription(meta.description ?? "");
        for (const s of meta.social ?? []) {
          if (s.type === "twitter") setX(s.data ?? "");
          if (s.type === "telegram") setTelegram(s.data ?? "");
        }
        return;
      }
    } catch {
      // Prefill is best-effort; an empty form is still editable.
    }
    // Nothing hosted here yet — a launch composed somewhere else has no
    // file until the first save. Its words, if it has any, are in the index,
    // and starting from them is what keeps "replace the image" from
    // silently blanking a description the owner never meant to touch.
    try {
      const indexed = await fetchIndexedLaunch(asset);
      if (indexed?.displayDescription) setDescription(indexed.displayDescription);
    } catch {
      // Same: best-effort.
    }
  };

  const busy = state.status === "signing" || state.status === "saving";
  const canSave = !busy && isValidX(x) && isValidTelegram(telegram);

  // With a session the server already knows who we are, so saving is a plain
  // request and the wallet is never opened. Without one — sessions not
  // configured, or the cookie lapsed — fall back to signing a challenge bound
  // to a hash of this exact content, which costs a wallet prompt.
  const hasSession = !!sessionAddress && sessionAddress === address;

  const save = async () => {
    if (!canSave) return;
    try {
      const imageSha = image
        ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", await image.arrayBuffer()))]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
        : "";
      const payload = JSON.stringify({
        asset,
        // Not editable: the ticker IS the name. Still part of the signed
        // payload as an empty string, because the server hashes the same
        // shape and falls back to the asset name when it's blank.
        name: "",
        description: description.trim(),
        x,
        telegram,
        image_sha256: imageSha,
      });
      const payloadHash = [
        ...new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)),
        ),
      ]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const issued = Math.floor(Date.now() / 1000);
      const message = `xcp-fun-edit\nasset:${asset}\naddress:${address}\nissued:${issued}\npayload:${payloadHash}`;

      let signature = "";
      if (!hasSession) {
        setState({ status: "signing" });
        signature = await signMessage(message);
      }

      setState({ status: "saving" });
      const form = new FormData();
      form.set("asset", asset);
      form.set("name", "");
      form.set("description", description.trim());
      form.set("x", x);
      form.set("telegram", telegram);
      if (image) form.set("image", image);
      form.set("address", address);
      form.set("signature", signature);
      form.set("issued", String(issued));
      const res = await fetch("/api/launches", {
        method: "PUT",
        body: form,
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setState({ status: "saved" });
    } catch (e) {
      setState({
        status: "error",
        error: e instanceof Error ? e.message : "Something went wrong",
      });
    }
  };

  return (
    <details className="mt-4 rounded-3xl border border-gray-200 bg-white" onToggle={prefill}>
      <summary className="cursor-pointer p-4 text-sm font-semibold text-gray-700">
        Edit token info <span className="font-normal text-gray-400">(you own this asset)</span>
      </summary>
      <div className="space-y-4 border-t border-gray-100 p-4">
        <p className="text-xs text-gray-500">
          What xcp.fun shows for this launch, and what the hosted metadata says
          if your on-chain description points here. The on-chain field itself is
          locked forever; everything behind it is yours to curate.
        </p>
        <div>
          <label htmlFor="edit-description" className="text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2.5 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="edit-x" className="text-sm font-medium text-gray-700">
              X profile
            </label>
            <input
              id="edit-x"
              type="text"
              value={x}
              onChange={(e) => setX(e.target.value)}
              placeholder="https://x.com/yourtoken"
              className={`mt-1 block w-full rounded-md border bg-white p-2.5 text-sm outline-none ${
                isValidX(x) ? "border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-500" : "border-red-400"
              }`}
            />
          </div>
          <div>
            <label htmlFor="edit-telegram" className="text-sm font-medium text-gray-700">
              Telegram
            </label>
            <input
              id="edit-telegram"
              type="text"
              value={telegram}
              onChange={(e) => setTelegram(e.target.value)}
              placeholder="https://t.me/yourtoken"
              className={`mt-1 block w-full rounded-md border bg-white p-2.5 text-sm outline-none ${
                isValidTelegram(telegram)
                  ? "border-gray-300 focus:border-purple-500 focus:ring-2 focus:ring-purple-500"
                  : "border-red-400"
              }`}
            />
          </div>
        </div>
        <div>
          <label htmlFor="edit-image" className="text-sm font-medium text-gray-700">
            Replace image <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <input
            id="edit-image"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={async (e) => {
              const file = e.target.files?.[0] ?? null;
              setImage(file);
              setAnimatedWebp(file ? await fileIsAnimatedWebp(file) : false);
            }}
            className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          {animatedWebp && (
            <p className="mt-2 text-xs text-amber-700">
              Animated WEBP shows as a still frame in the announce channel — Telegram
              cannot play one. A GIF moves there too.
            </p>
          )}
        </div>
        {state.status === "error" && (
          <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            {state.error}
          </p>
        )}
        {state.status === "saved" && (
          <p className="rounded-md border border-green-200 bg-green-50 p-2 text-sm text-green-700">
            Saved. Cached pages may take a minute to refresh.
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.status === "signing"
            ? "Confirm in wallet…"
            : state.status === "saving"
              ? "Saving…"
              : "Sign & save"}
        </button>
      </div>
    </details>
  );
}
