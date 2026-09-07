// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeAndBroadcast } from "@xcp/wallet-sdk";
import { parseAmountDraft, type DecimalPlaces } from "@xcp/wallet-sdk/amounts";
import vectors from "@xcp/wallet-sdk/amounts/vectors";
import { AmountInput } from "../apps/web/src/components/amount-input";
import { parseAmountRaw, visibleDraft } from "../apps/web/src/lib/amount-draft";

let root: Root | undefined;
let container: HTMLDivElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  container?.remove();
  vi.unstubAllGlobals();
});

async function mount(decimals: 0 | 8 = 8, onSubmit = vi.fn(), initial = "") {
  function Form() {
    const [draft, setDraft] = useState(initial);
    const raw = parseAmountRaw(draft, decimals);
    return <form onSubmit={(event) => { event.preventDefault(); if (raw !== null && raw > 0n) onSubmit(raw); }}>
      <AmountInput value={draft} onChange={setDraft} decimals={decimals} ariaLabel="Amount" />
      <button disabled={raw === null || raw <= 0n}>Compose</button>
    </form>;
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root!.render(<Form />));
  return { input: container.querySelector("input")!, button: container.querySelector("button")!, onSubmit };
}

async function enter(input: HTMLInputElement, value: string, data: string | null = null) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data }));
  });
}
async function type(input: HTMLInputElement, text: string) {
  for (const char of text) await enter(input, input.value + char, char);
}
async function paste(input: HTMLInputElement, text: string) {
  input.setSelectionRange(0, input.value.length);
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  await act(() => { input.dispatchEvent(event); });
}

describe("actual amount editing and submit boundary", () => {
  it.each(["-5", "+5", "1e5", "0,5", "1,234", "1.2.3", "0.000000001"])(
    "keeps sequential %s invalid instead of composing another amount", async (draft) => {
      const { input, button, onSubmit } = await mount();
      await type(input, draft);
      expect(input.value).toBe(draft);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(button.disabled).toBe(true);
      await act(() => { button.click(); });
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );
  it("does not reuse the last valid quantity after an invalid edit", async () => {
    const { input, button, onSubmit } = await mount(8, vi.fn(), "5");
    expect(button.disabled).toBe(false);
    await type(input, "e2");
    expect(input.value).toBe("5e2");
    expect(button.disabled).toBe(true);
    await act(() => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(onSubmit).not.toHaveBeenCalled();
    await enter(input, "5");
    await act(() => { button.click(); });
    expect(onSubmit).toHaveBeenCalledWith(500_000_000n);
  });
  it("keeps an indivisible decimal draft intact and disabled", async () => {
    const { input, button } = await mount(0);
    await type(input, "0.5");
    expect(input.value).toBe("0.5");
    expect(button.disabled).toBe(true);
    await enter(input, "100");
    expect(button.disabled).toBe(false);
    expect(parseAmountRaw(input.value, 0)).toBe(100n);
  });
  it.each(["1,234", "1\n234", "1\r\n234", "1\t234", "１.５", "12 XCP", "0.000000001", "1".repeat(129)])(
    "keeps pasted %j invalid, including before native text cleanup", async (text) => {
      const { input, button } = await mount(8, vi.fn(), "5");
      await paste(input, text);
      expect(input.value).toBe(visibleDraft(text));
      expect(button.disabled).toBe(true);
      expect(input.hasAttribute("maxlength")).toBe(false);
    },
  );
  it("preserves dropped control text as a visible invalid draft", async () => {
    const { input, button } = await mount(8, vi.fn(), "5");
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { getData: () => "1\n234" } });
    await act(() => { input.dispatchEvent(event); });
    expect(input.value).toBe("1\\n234");
    expect(button.disabled).toBe(true);
  });
  it.each(vectors.editing.filter((item) => item.decimals === 0 || item.decimals === 8))(
    "replays shared editing vector $id through the rendered input", async (vector) => {
      const { input, button } = await mount(vector.decimals as 0 | 8);
      for (let index = 0; index < vector.drafts.length; index++) {
        const draft = vector.drafts[index]!;
        await enter(input, draft);
        expect(input.value).toBe(draft);
        const parsed = parseAmountDraft(input.value, { decimals: vector.decimals as DecimalPlaces });
        expect(parsed.status).toBe(vector.statuses[index]);
        expect(button.disabled).toBe(parsed.status !== "valid" || parsed.raw === 0n);
      }
    },
  );
});

describe("real SDK compose HTTP parameters", () => {
  it.each([
    ["0.001", "100000"], ["0.00000001", "1"], ["100000000.00000001", "10000000000000001"],
  ])("sends precisely the accepted %s and a separate fractional fee", async (draft, expected) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ error: "test boundary reached" }), { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    const signer = { address: "1CounterpartyXXXXXXXXXXXXXXXUWLpVr", signTransaction: vi.fn(), broadcastTransaction: vi.fn() } as unknown as Parameters<typeof composeAndBroadcast>[0];
    const { input, button, onSubmit } = await mount();
    await type(input, draft);
    await act(() => { button.click(); });
    const raw = onSubmit.mock.calls[0]![0] as bigint;
    await expect(composeAndBroadcast(signer, "order", {
      give_asset: "XCP", give_quantity: raw, get_asset: "TOKEN", get_quantity: 1n, expiration: 100, fee_required: 0,
    }, { feeRate: 0.1 })).rejects.toThrow("test boundary reached");
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.pathname).toContain("/compose/order");
    expect(url.searchParams.get("give_quantity")).toBe(expected);
    expect(url.searchParams.get("get_quantity")).toBe("1");
    expect(url.searchParams.get("sat_per_vbyte")).toBe("0.1");
    expect(signer.signTransaction).not.toHaveBeenCalled();
    expect(signer.broadcastTransaction).not.toHaveBeenCalled();
  });
});
