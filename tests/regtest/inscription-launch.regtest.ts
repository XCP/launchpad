/**
 * An XCP-69 inscription launch, end to end, against the Docker regtest pair:
 * the same commit and reveal the create page builds, signed here by a
 * throwaway taproot key standing in for the wallet, mined, and then read back
 * from counterparty-core to check what it parsed. The point is the envelope:
 * the fairminter array with the JSON URL as its description, the image as
 * the inscription, and the name in the ord properties.
 */
import { execFileSync } from "node:child_process";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hex } from "@scure/base";
import * as btc from "@scure/btc-signer";
import { beforeAll, describe, expect, it, vi } from "vitest";

const REGTEST = { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef };
const REGTEST_BURN = "mvCounterpartyXXXXXXXXXXXXXXW24Hef";
const CP = "http://127.0.0.1:24000/v2";
const CONTAINER = "digirare-regtest-bitcoin-core-1";
const FUNDING_WALLET = "digirare-runner";

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

async function cp<T>(path: string): Promise<T> {
  const res = await fetch(`${CP}${path}`);
  return (await res.json()) as T;
}

async function mine(n = 1): Promise<void> {
  const to = cli(`-rpcwallet=${FUNDING_WALLET}`, "getnewaddress", "mine", "bech32m");
  cli("generatetoaddress", String(n), to);
  const target = Number(cli("getblockcount"));
  for (let i = 0; i < 60; i++) {
    const { result } = await cp<{ result: { counterparty_height: number } }>("/");
    if (result.counterparty_height >= target) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("counterparty-core did not catch up");
}

/** A numeric asset (id above 26^12) needs no XCP fee, so the launch is valid with BTC alone. */
const ASSET = `A${(95_500_000_000_000_000n + BigInt(Date.now() % 1_000_000_000)).toString()}`;
const LP_ASSET = `A${(96_000_000_000_000_000n + BigInt(Date.now() % 1_000_000_000)).toString()}`;
const JSON_URL = `https://xcp.fun/${ASSET}.json`;

describe("inscription launch on regtest", () => {
  const priv = secp256k1.utils.randomPrivateKey();
  const pub = secp256k1.getPublicKey(priv, true).slice(1); // x-only
  const wallet = btc.p2tr(pub, undefined, REGTEST);
  let image: Uint8Array;

  beforeAll(async () => {
    const res = await fetch("https://xcp.fun/i/OKAYORDINAL");
    image = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get("content-type")).toContain("image/webp");
  });

  it("creates the fairminter with the JSON URL as description and the image inscribed", async () => {
    // fund the throwaway wallet from the runner
    const fundTxid = cli(`-rpcwallet=${FUNDING_WALLET}`, "sendtoaddress", wallet.address!, "0.05");
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
        asset: ASSET,
        lpAsset: LP_ASSET,
        startBlock,
        softCapDeadlineBlock: startBlock + XCP69.DEADLINE_BLOCKS,
        imageData: image,
        mimeType: "image/webp",
        feeRate: 2,
        description: JSON_URL,
      },
      pub,
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
    commitTx.updateInput(0, { tapInternalKey: pub });
    commitTx.signIdx(priv, 0, [btc.SigHash.ALL]);
    const commitRaw = finalizeSignedPsbt(hex.encode(commitTx.toPSBT()));
    const commitTxid = cli("sendrawtransaction", commitRaw);
    expect(commitTxid).toBe(txidFromRawTx(commitRaw));
    await mine(1);

    // reveal: the script-path spend carrying the envelope, inscription output burned
    const reveal = buildRevealPsbt({
      pubkey: pub,
      commitTxid,
      commitVout: 0,
      commitAmount: prepared.commitAmount,
      revealScript: prepared.revealScript,
      tapInternalKey: prepared.tapInternalKey,
      feeRate: 2,
      recipientAddress: REGTEST_BURN,
    });
    const revealTx = btc.Transaction.fromPSBT(hex.decode(reveal.psbtHex));
    revealTx.signIdx(priv, 0, [btc.SigHash.ALL]);
    const revealRaw = finalizeSignedPsbt(hex.encode(revealTx.toPSBT()));

    // what the node makes of the raw reveal, before it is even broadcast
    const info = await cp<{ result: { decoded_tx: { parsed_vouts: unknown }; unpacked_data: unknown } }>(
      `/transactions/info?rawtransaction=${revealRaw}&block_index=${height + 2}`,
    );
    console.log("parsed_vouts:", JSON.stringify(info.result.decoded_tx.parsed_vouts).slice(0, 300));
    console.log("unpacked_data:", JSON.stringify(info.result.unpacked_data).slice(0, 900));

    const revealTxid = cli("sendrawtransaction", revealRaw);
    await mine(2);

    const tx = await cp<{ result: { unpacked_data?: { message_type: string; message_data: Record<string, unknown> } } | null }>(
      `/transactions/${revealTxid}?verbose=true`,
    );
    expect(tx.result, "counterparty-core should index the reveal as a Counterparty transaction").not.toBeNull();
    const data = tx.result!.unpacked_data!;
    expect(data.message_type).toBe("fairminter");
    expect(data.message_data.asset).toBe(ASSET);
    expect(data.message_data.description).toBe(JSON_URL);
    expect(data.message_data.mime_type).toBe("text/plain");

    const fm = await cp<{ result: { asset: string; status: string; description: string; source: string }[] }>(
      `/assets/${ASSET}/fairminters?verbose=true`,
    );
    expect(fm.result).toHaveLength(1);
    console.log("fairminter:", fm.result[0].status, fm.result[0].description, "source", fm.result[0].source);
    expect(fm.result[0].status).toBe("pending");
    expect(fm.result[0].description).toBe(JSON_URL);
    console.log("reveal", revealTxid, "inscription", `${revealTxid}i0`);
  });
});
