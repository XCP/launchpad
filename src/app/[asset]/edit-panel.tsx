"use client";

import { useState } from "react";
import { isValidSocial } from "@/lib/social";
import { useWallet } from "@/lib/wallet/wallet-context";

/**
 * Issuer-only metadata editing. The on-chain description URL is locked; the
 * hosted JSON behind it stays curatable by the asset's owner. Display is
 * gated on the connected address matching the launch creator; the server
 * independently verifies a BIP-322 signature AND checks the CURRENT on-chain
 * owner, so this gate is cosmetic.
 */
export function EditPanel({ asset, issuer }: { asset: string; issuer: string }) {
  const { address, status: walletStatus, signMessage } = useWallet();
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [x, setX] = useState("");
  const [telegram, setTelegram] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [state, setState] = useState<
    | { status: "idle" | "signing" | "saving" | "saved" }
    | { status: "error"; error: string }
  >({ status: "idle" });

  if (walletStatus !== "connected" || address !== issuer) return null;

  const prefill = async () => {
    if (loaded) return;
    setLoaded(true);
    try {
      const res = await fetch(`/j/${asset}.json`);
      if (!res.ok) return;
      const meta = await res.json();
      setName(meta.name === asset ? "" : (meta.name ?? ""));
      setDescription(meta.description ?? "");
      for (const s of meta.social ?? []) {
        if (s.type === "twitter") setX(s.data ?? "");
        if (s.type === "telegram") setTelegram(s.data ?? "");
      }
    } catch {
      // Prefill is best-effort; an empty form is still editable.
    }
  };

  const busy = state.status === "signing" || state.status === "saving";
  const canSave = !busy && isValidSocial(x) && isValidSocial(telegram);

  const save = async () => {
    if (!canSave) return;
    try {
      // Hash the exact content, sign a challenge binding it — the server
      // recomputes both, so the signature can't be replayed on other content.
      const imageSha = image
        ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", await image.arrayBuffer()))]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
        : "";
      const payload = JSON.stringify({
        asset,
        name: name.trim().slice(0, 127),
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

      setState({ status: "signing" });
      const signature = await signMessage(message);

      setState({ status: "saving" });
      const form = new FormData();
      form.set("asset", asset);
      form.set("name", name.trim().slice(0, 127));
      form.set("description", description.trim());
      form.set("x", x);
      form.set("telegram", telegram);
      if (image) form.set("image", image);
      form.set("address", address);
      form.set("signature", signature);
      form.set("issued", String(issued));
      const res = await fetch("/api/launches", { method: "PUT", body: form });
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
    <details className="rounded-lg border border-gray-200 bg-white" onToggle={prefill}>
      <summary className="cursor-pointer p-4 text-sm font-semibold text-gray-700">
        Edit token info <span className="font-normal text-gray-400">(you created this launch)</span>
      </summary>
      <div className="space-y-4 border-t border-gray-100 p-4">
        <p className="text-xs text-gray-500">
          The on-chain description URL is locked forever; the info behind it is
          yours to curate. Saving asks your wallet to sign a message — no
          transaction, no fee.
        </p>
        <div>
          <label htmlFor="edit-name" className="text-sm font-medium text-gray-700">
            Display name
          </label>
          <input
            id="edit-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={asset}
            maxLength={127}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2.5 text-sm outline-none focus:border-purple-500"
          />
        </div>
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
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white p-2.5 text-sm outline-none focus:border-purple-500"
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
                isValidSocial(x) ? "border-gray-300 focus:border-purple-500" : "border-red-400"
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
                isValidSocial(telegram)
                  ? "border-gray-300 focus:border-purple-500"
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
            onChange={(e) => setImage(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
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
