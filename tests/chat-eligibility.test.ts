import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAssetBalanceOrThrow } from "@/lib/api/counterparty";
import { fetchMintingXcpPaid } from "@/lib/api/launchpad-api";
import { CHAT_MIN_XCP_RAW, holdsChatMinimum } from "@/lib/chat-eligibility";

vi.mock("@/lib/api/counterparty", () => ({ fetchAssetBalanceOrThrow: vi.fn() }));
vi.mock("@/lib/api/launchpad-api", () => ({ fetchMintingXcpPaid: vi.fn() }));

const MINUTE = 60_000;
let n = 0;
// A fresh address per test, since verdicts are cached per isolate.
const wallet = () => `bc1qwallet${n++}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchMintingXcpPaid).mockResolvedValue(0n);
});

describe("chat minimum balance", () => {
  it("is 10 XCP in raw units, inclusive", async () => {
    expect(CHAT_MIN_XCP_RAW).toBe(1_000_000_000n);
    vi.mocked(fetchAssetBalanceOrThrow).mockResolvedValueOnce(1_000_000_000n);
    expect(await holdsChatMinimum(wallet())).toBe(true);
    vi.mocked(fetchAssetBalanceOrThrow).mockResolvedValueOnce(999_999_999n);
    expect(await holdsChatMinimum(wallet())).toBe(false);
  });

  it("counts XCP escrowed in launches that are still minting", async () => {
    const address = wallet();
    vi.mocked(fetchAssetBalanceOrThrow).mockResolvedValueOnce(400_000_000n);
    vi.mocked(fetchMintingXcpPaid).mockResolvedValueOnce(600_000_000n);
    expect(await holdsChatMinimum(address)).toBe(true);
    expect(fetchAssetBalanceOrThrow).toHaveBeenCalledWith(address, "XCP");
    expect(fetchMintingXcpPaid).toHaveBeenCalledWith(address);
  });

  it("keeps a holder for ten minutes and re-reads a short wallet after one", async () => {
    const holder = wallet(); const short = wallet(); const now = 1_000_000;
    vi.mocked(fetchAssetBalanceOrThrow).mockResolvedValueOnce(2_000_000_000n).mockResolvedValueOnce(0n);
    expect(await holdsChatMinimum(holder, now)).toBe(true);
    expect(await holdsChatMinimum(short, now)).toBe(false);
    vi.mocked(fetchAssetBalanceOrThrow).mockResolvedValue(0n);
    expect(await holdsChatMinimum(holder, now + 10 * MINUTE - 1)).toBe(true);
    expect(await holdsChatMinimum(short, now + MINUTE - 1)).toBe(false);
    expect(fetchAssetBalanceOrThrow).toHaveBeenCalledTimes(2);
    vi.mocked(fetchAssetBalanceOrThrow).mockResolvedValueOnce(1_000_000_000n);
    expect(await holdsChatMinimum(short, now + MINUTE)).toBe(true);
    expect(await holdsChatMinimum(holder, now + 10 * MINUTE)).toBe(false);
  });

  it("throws rather than deciding when either read fails, and caches nothing", async () => {
    const address = wallet();
    vi.mocked(fetchAssetBalanceOrThrow).mockRejectedValueOnce(new Error("node down"));
    await expect(holdsChatMinimum(address)).rejects.toThrow("node down");
    vi.mocked(fetchAssetBalanceOrThrow).mockResolvedValueOnce(5_000_000_000n);
    vi.mocked(fetchMintingXcpPaid).mockRejectedValueOnce(new Error("index down"));
    await expect(holdsChatMinimum(address)).rejects.toThrow("index down");
    vi.mocked(fetchAssetBalanceOrThrow).mockResolvedValueOnce(5_000_000_000n);
    expect(await holdsChatMinimum(address)).toBe(true);
  });
});
