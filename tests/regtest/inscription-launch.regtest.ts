/**
 * An XCP-69 inscription launch, end to end, against a Docker regtest pair:
 * the same commit and reveal the create page builds, signed here by a
 * throwaway taproot key standing in for the wallet, mined, and then read back
 * from counterparty-core to check what it parsed. The point is the envelope:
 * the fairminter array with the JSON URL as its description, the image as
 * the inscription, and the name in the ord properties.
 *
 * Core 11.5 (`require_reveal_source_signature`, on from block 0 on regtest)
 * counts a reveal only when the envelope leaf is closed by a key of the
 * commit's funder and Bitcoin has checked that key's signature. The create
 * page closes the leaf with the source address's Taproot output key, and the
 * wallet signs the script path with the matching tweaked private key; this
 * does exactly the same, and also shows a leaf closed by any other key is
 * ignored.
 *
 * Start the pair with
 *   docker compose -f tests/regtest/docker-compose.yml -p launchpad-regtest up -d
 * or point REGTEST_CP_API / REGTEST_BITCOIN_CONTAINER at another one.
 */
import { execFileSync } from "node:child_process";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hex } from "@scure/base";
import * as btc from "@scure/btc-signer";
import { taprootTweakPrivKey } from "@scure/btc-signer/utils.js";
import { beforeAll, describe, expect, it, vi } from "vitest";

const REGTEST = { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const REGTEST_BURN = "mvCounterpartyXXXXXXXXXXXXXXW24Hef";
const CP = process.env.REGTEST_CP_API ?? "http://127.0.0.1:24100/v2";
const CONTAINER = process.env.REGTEST_BITCOIN_CONTAINER ?? "launchpad-regtest-bitcoin-core-1";
const FUNDING_WALLET = process.env.REGTEST_FUNDING_WALLET ?? "launchpad-runner";

vi.mock("@/lib/inscriber/constants", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/inscriber/constants")>();
  return { ...original, NETWORK: REGTEST, BURN_ADDRESS: REGTEST_BURN, COUNTERPARTY_BURN_ADDRESS: REGTEST_BURN };
});

const { prepareFairminterInscriptionPsbt } = await import("@/lib/inscriber/fairminter");
const { buildCommitFundingPsbt, buildRevealPsbt, finalizeSignedPsbt, txidFromRawTx } = await import(
  "@/lib/inscriber/transactions"
);
const { XCP69 } = await import("@launchpad/xcp69/xcp69");

function cli(...args: string[]): string {
  return execFileSync(
    "docker",
    ["exec", CONTAINER, "bitcoin-cli", "-regtest", "-rpcuser=rpc", "-rpcpassword=rpc", ...args],
    { encoding: "utf-8" },
  ).trim();
}
const rpc = <T>(...args: string[]): T => JSON.parse(cli(...args)) as T;
const walletCli = (...args: string[]) => cli(`-rpcwallet=${FUNDING_WALLET}`, ...args);

async function cp<T>(path: string): Promise<T> {
  const res = await fetch(`${CP}${path}`);
  return (await res.json()) as T;
}

async function mine(n = 1): Promise<void> {
  const to = walletCli("getnewaddress", "mine", "bech32m");
  cli("generatetoaddress", String(n), to);
  const target = Number(cli("getblockcount"));
  for (let i = 0; i < 120; i++) {
    const { result } = await cp<{ result: { counterparty_height: number } }>("/");
    if (result.counterparty_height >= target) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("counterparty-core did not catch up");
}

/** A fresh pair has no wallet and no mature coins; make both. */
async function ensureFundingWallet(): Promise<void> {
  const loaded = rpc<string[]>("listwallets");
  if (!loaded.includes(FUNDING_WALLET)) {
    const onDisk = rpc<{ wallets: { name: string }[] }>("listwalletdir").wallets.map((w) => w.name);
    cli(onDisk.includes(FUNDING_WALLET) ? "loadwallet" : "createwallet", FUNDING_WALLET);
  }
  if (Number(walletCli("getbalance")) < 1) await mine(101);
}

/** A numeric asset (id above 26^12) needs no XCP fee, so the launch is valid with BTC alone. */
function numericAsset(base: bigint): string {
  return `A${(base + BigInt(Date.now() % 1_000_000_000)).toString()}`;
}

interface Signer {
  /** x-only key the envelope leaf is closed with */
  leafKey: Uint8Array;
  /** the private key whose x-only public key is `leafKey` */
  leafPriv: Uint8Array;
}

describe("inscription launch on regtest", () => {
  // The wallet: a BIP86-style key-path address. Its output key (the bech32m
  // witness program) is what the create page reads from the address and closes
  // the leaf with; the tweaked private key is what signs for it.
  const priv = secp256k1.utils.randomPrivateKey();
  const internalKey = secp256k1.getPublicKey(priv, true).slice(1);
  const wallet = btc.p2tr(internalKey, undefined, REGTEST);
  const outputKey = btc.Address(REGTEST).decode(wallet.address!) as { type: "tr"; pubkey: Uint8Array };
  const walletSigner: Signer = { leafKey: outputKey.pubkey, leafPriv: taprootTweakPrivKey(priv) };
  let image: Uint8Array;

  beforeAll(async () => {
    const res = await fetch("https://xcp.fun/i/OKAYORDINAL");
    image = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get("content-type")).toContain("image/webp");
    await ensureFundingWallet();
  });

  it("closes the leaf with the address's own output key, as the create page does", () => {
    expect(hex.encode(outputKey.pubkey)).not.toBe(hex.encode(internalKey));
    expect(hex.encode(secp256k1.getPublicKey(walletSigner.leafPriv, true).slice(1))).toBe(
      hex.encode(outputKey.pubkey),
    );
  });

  /** Fund the wallet, commit from it, and reveal through a leaf closed by `signer`. */
  async function launch(asset: string, lpAsset: string, jsonUrl: string, signer: Signer) {
    const fundTxid = walletCli("sendtoaddress", wallet.address!, "0.05");
    await mine(1);
    const fundTx = rpc<{ vout: { n: number; value: number; scriptPubKey: { hex: string } }[] }>(
      "getrawtransaction",
      fundTxid,
      "true",
    );
    const funded = fundTx.vout.find((o) => o.scriptPubKey.hex === hex.encode(wallet.script))!;
    expect(funded).toBeDefined();

    const height = Number(cli("getblockcount"));
    const startBlock = height + 20;
    const prepared = prepareFairminterInscriptionPsbt(
      {
        asset,
        lpAsset,
        startBlock,
        softCapDeadlineBlock: startBlock + XCP69.DEADLINE_BLOCKS,
        imageData: image,
        mimeType: "image/webp",
        feeRate: 2,
        description: jsonUrl,
      },
      signer.leafKey,
    );

    // commit: the wallet's key-path spend of the funding output
    const commit = buildCommitFundingPsbt({
      fundingUtxo: {
        txid: fundTxid,
        vout: funded.n,
        value: Math.round(funded.value * 1e8),
        scriptPubKey: wallet.script,
      },
      commitAddress: prepared.commitAddress,
      commitAmount: prepared.commitAmount,
      changeAddress: wallet.address!,
      feeRate: 2,
    });
    const commitTx = btc.Transaction.fromPSBT(hex.decode(commit.psbtHex));
    commitTx.updateInput(0, { tapInternalKey: internalKey });
    commitTx.signIdx(priv, 0, [btc.SigHash.ALL]);
    const commitRaw = finalizeSignedPsbt(hex.encode(commitTx.toPSBT()));
    const commitTxid = cli("sendrawtransaction", commitRaw);
    expect(commitTxid).toBe(txidFromRawTx(commitRaw));
    await mine(1);

    // reveal: the script-path spend carrying the envelope, inscription output burned
    const reveal = buildRevealPsbt({
      pubkey: signer.leafKey,
      commitTxid,
      commitVout: 0,
      commitAmount: prepared.commitAmount,
      revealScript: prepared.revealScript,
      tapInternalKey: prepared.tapInternalKey,
      feeRate: 2,
      recipientAddress: REGTEST_BURN,
    });
    const revealTx = btc.Transaction.fromPSBT(hex.decode(reveal.psbtHex));
    revealTx.signIdx(signer.leafPriv, 0, [btc.SigHash.ALL]);
    const revealRaw = finalizeSignedPsbt(hex.encode(revealTx.toPSBT()));

    const revealTxid = cli("sendrawtransaction", revealRaw);
    await mine(2);
    // Bitcoin accepted and mined it either way; only Core's reading differs.
    expect(rpc<{ confirmations: number }>("getrawtransaction", revealTxid, "true").confirmations).toBeGreaterThan(0);
    return { commitTxid, revealTxid };
  }

  it("creates the fairminter from the source, with the JSON URL as description and the image inscribed", async () => {
    const asset = numericAsset(95_500_000_000_000_000n);
    const lpAsset = numericAsset(96_000_000_000_000_000n);
    const jsonUrl = `https://xcp.fun/${asset}.json`;
    const { revealTxid } = await launch(asset, lpAsset, jsonUrl, walletSigner);

    const tx = await cp<{
      result: { source: string; unpacked_data?: { message_type: string; message_data: Record<string, unknown> } } | null;
    }>(`/transactions/${revealTxid}?verbose=true`);
    expect(tx.result, "counterparty-core should index the reveal as a Counterparty transaction").toBeTruthy();
    expect(tx.result!.source).toBe(wallet.address);
    const data = tx.result!.unpacked_data!;
    expect(data.message_type).toBe("fairminter");
    expect(data.message_data.asset).toBe(asset);
    expect(data.message_data.description).toBe(jsonUrl);
    expect(data.message_data.mime_type).toBe("text/plain");

    const fm = await cp<{ result: { asset: string; status: string; description: string; source: string }[] }>(
      `/assets/${asset}/fairminters?verbose=true`,
    );
    expect(fm.result).toHaveLength(1);
    expect(fm.result[0].source).toBe(wallet.address);
    expect(fm.result[0].status).toBe("pending");
    expect(fm.result[0].description).toBe(jsonUrl);
    console.log("reveal", revealTxid, "inscription", `${revealTxid}i0`, "source", fm.result[0].source);
  });

  it("ignores a reveal whose leaf is closed by a key that is not the source's", async () => {
    const strangerPriv = secp256k1.utils.randomPrivateKey();
    const stranger: Signer = {
      leafKey: secp256k1.getPublicKey(strangerPriv, true).slice(1),
      leafPriv: strangerPriv,
    };
    const asset = numericAsset(95_600_000_000_000_000n);
    const lpAsset = numericAsset(96_100_000_000_000_000n);
    const { revealTxid } = await launch(asset, lpAsset, `https://xcp.fun/${asset}.json`, stranger);

    const tx = await cp<{ result?: unknown; error?: string }>(`/transactions/${revealTxid}?verbose=true`);
    expect(tx.result ?? null, "the reveal must not be a Counterparty transaction").toBeNull();
    const fm = await cp<{ result?: unknown[]; error?: string }>(`/assets/${asset}/fairminters?verbose=true`);
    expect(fm.result ?? []).toHaveLength(0);
  });
});
