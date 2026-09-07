import { afterEach, describe, expect, it, vi } from "vitest";
import { composeAndBroadcast } from "@xcp/wallet-sdk";
import { parseUnitsToRaw } from "../apps/web/src/lib/numeric";
import { AmountInput, sanitizeAmount } from "../apps/web/src/components/amount-input";

/**
 * Contract verified against local Counterparty Core 67e10db3:
 * api/apiserver.py prepare_args parses quantities with int(str_arg).
 * api/compose.py declares order/fairmint/pool quantities as raw integers;
 * config.UNIT is 100_000_000. sat_per_vbyte is a separate float.
 * These tests reach the installed wallet SDK's actual compose query builder.
 * The mocked HTTP error stops before signing or broadcasting anything.
 */
afterEach(() => { vi.unstubAllGlobals(); });

function enter(value: string, inputType = "insertText", previous = "", decimals: 0 | 8 = 8, data = value.slice(-1)) {
  const onChange = vi.fn();
  const input = AmountInput({ value: previous, onChange, decimals });
  input.props.onChange({ target: { value }, nativeEvent: { inputType, data } });
  return { value: onChange.mock.calls[0]?.[0] as string | undefined, onChange };
}

function typeAmount(typed: string, decimals: 0 | 8 = 8): string {
  let value = "";
  for (const char of typed) {
    const next = enter(value + char, "insertText", value, decimals);
    expect(next.onChange, `keystroke ${JSON.stringify(char)} after ${value}`).toHaveBeenCalledOnce();
    value = next.value!;
  }
  return value;
}

describe("an accepted amount retains its value", () => {
  it.each([
    ["0.001", 100_000n],
    ["1.234", 123_400_000n],
    ["0.00000001", 1n],
    ["100000000.00000001", 10_000_000_000_000_001n],
  ] as const)("types %s without treating its third decimal as grouping", (typed, raw) => {
    expect(typeAmount(typed)).toBe(typed);
    expect(parseUnitsToRaw(typeAmount(typed))).toBe(raw);
  });

  it("normalizes a decimal keyboard comma before it reaches state", () => {
    expect(typeAmount("0,001")).toBe("0.001");
    expect(parseUnitsToRaw(typeAmount("0,00000001"))).toBe(1n);
    expect(typeAmount("1,234")).toBe("1.234");
    expect(enter("1,234", "insertText", "", 8, "1,234").onChange).not.toHaveBeenCalled();
  });

  it("keeps editable decimal states", () => {
    expect(sanitizeAmount("")).toBe("");
    expect(sanitizeAmount(".")).toBe("0.");
    expect(sanitizeAmount("5.")).toBe("5.");
    expect(sanitizeAmount(".5")).toBe(".5");
  });

  it.each([
    "1,234", "1,234.56", "1.234,56", "1.234.567", "1,234,567",
    "1 234.56", "1\u00a0234,56", "1\u202f234,56", "0,5", " 1.5 ",
    "-1", "+1", "1e5", "1e-8", "NaN", "Infinity", "$12", "12 XCP", "1.2.3", "１.５", "١.٥",
  ])("rejects ambiguous or unsupported paste %s", (text) => {
    expect(sanitizeAmount(text)).toBeNull();
    for (const inputType of ["insertFromPaste", "insertFromDrop"]) {
      expect(enter(text, inputType, "2").onChange).not.toHaveBeenCalled();
    }
  });

  it("accepts exact plain paste and rejects a ninth decimal", () => {
    expect(enter("100000000.00000001", "insertFromPaste").value).toBe("100000000.00000001");
    expect(enter("0.000000001", "insertText", "0.00000000").onChange).not.toHaveBeenCalled();
    expect(sanitizeAmount("1.999999999")).toBeNull();
  });

  it("rejects an overlong paste as a whole instead of letting the browser truncate its value", () => {
    const input = AmountInput({ value: "2", onChange: vi.fn() });
    expect(input.props.maxLength).toBeUndefined();
    const text = `${"0".repeat(26)}1`;
    expect(parseUnitsToRaw(text)).toBe(100_000_000n);
    expect(enter(text, "insertFromPaste", "2").onChange).not.toHaveBeenCalled();
  });

  it.each(["1\n234", "1\r234", "1\r\n234", "1,234", "1.234,56", "1e5"])(
    "rejects the original clipboard/drop text %j before the browser can sanitize it", (text) => {
      const input = AmountInput({ value: "2", onChange: vi.fn() });
      const preventPaste = vi.fn();
      const preventDrop = vi.fn();
      input.props.onPaste({ clipboardData: { getData: () => text }, preventDefault: preventPaste });
      input.props.onDrop({ dataTransfer: { getData: () => text }, preventDefault: preventDrop });
      expect(preventPaste).toHaveBeenCalledOnce();
      expect(preventDrop).toHaveBeenCalledOnce();
    },
  );

  it("lets a plain decimal paste reach the normal exact-input validation", () => {
    const input = AmountInput({ value: "", onChange: vi.fn() });
    const preventDefault = vi.fn();
    input.props.onPaste({ clipboardData: { getData: () => "0.00000001" }, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(enter("0.00000001", "insertFromPaste").value).toBe("0.00000001");
  });

  it("keeps raw satoshi fields integral", () => {
    expect(typeAmount("1234", 0)).toBe("1234");
    expect(parseUnitsToRaw(typeAmount("1234", 0), 0)).toBe(1234n);
    expect(sanitizeAmount("1.5", 0)).toBeNull();
    expect(enter("1,", "insertText", "1", 0).onChange).not.toHaveBeenCalled();
  });
});

describe("the actual compose HTTP parameters", () => {
  it.each([
    ["0.001", "100000"],
    ["0.00000001", "1"],
    ["100000000.00000001", "10000000000000001"],
  ])("sends the exact raw digits for %s, with fractional fees separate", async (typed, expected) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ error: "test boundary reached" }), { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    const signer = {
      address: "1CounterpartyXXXXXXXXXXXXXXXUWLpVr",
      signTransaction: vi.fn(),
      broadcastTransaction: vi.fn(),
    } as unknown as Parameters<typeof composeAndBroadcast>[0];
    await expect(composeAndBroadcast(signer, "order", {
      give_asset: "XCP",
      give_quantity: parseUnitsToRaw(typeAmount(typed))!,
      get_asset: "TOKEN",
      get_quantity: 1n,
      expiration: 100,
      fee_required: 0,
    }, { feeRate: 0.1 })).rejects.toThrow("test boundary reached");
    expect(fetch).toHaveBeenCalledOnce();
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.pathname).toContain("/compose/order");
    expect(url.searchParams.get("give_quantity")).toBe(expected);
    expect(url.searchParams.get("get_quantity")).toBe("1");
    expect(url.searchParams.get("sat_per_vbyte")).toBe("0.1");
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(signer.broadcastTransaction).not.toHaveBeenCalled();
  });
});
