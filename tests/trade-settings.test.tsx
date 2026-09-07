// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SwapSettingsGear,
  SwapSettingsProvider,
  useSwapSettings,
} from "../apps/web/src/app/[lang]/swap/_components/swap-settings";
import { SETTINGS_DEFAULTS, updateSettings } from "../apps/web/src/app/[lang]/swap/_lib/trade-settings-store";

const snapshot = vi.hoisted(() => ({ customFeeRate: "" }));

// Supply the stored string at the external-store boundary while rendering
// the actual provider and consuming its derived fee through the actual hook.
vi.mock("@/app/[lang]/swap/_lib/trade-settings-store", async (importOriginal) => {
  const store = await importOriginal<typeof import("../apps/web/src/app/[lang]/swap/_lib/trade-settings-store")>();
  return {
    ...store,
    readSettingsServer: () => ({ ...store.SETTINGS_DEFAULTS, ...snapshot }),
  };
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

async function mountSettings(customSlippage = "") {
  updateSettings({ ...SETTINGS_DEFAULTS, customSlippage });
  const compose = vi.fn();
  function SubmitConsumer() {
    const settings = useSwapSettings();
    return <form onSubmit={(event) => {
      event.preventDefault();
      if (settings.swapSettingsValid) compose(settings.slippage);
    }}>
      <output data-auto={String(settings.slippageAuto)}>{String(settings.swapSettingsValid)}</output>
      <button disabled={!settings.swapSettingsValid}>Compose</button>
    </form>;
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root!.render(
    <SWRConfig value={{ provider: () => new Map(), revalidateOnMount: false }}>
      <SwapSettingsProvider><SwapSettingsGear /><SubmitConsumer /></SwapSettingsProvider>
    </SWRConfig>,
  ));
  await act(() => { container!.querySelector<HTMLButtonElement>('button[aria-label="Swap settings"]')!.click(); });
  return {
    input: document.querySelector<HTMLInputElement>('input[aria-label="Custom slippage percent"]')!,
    button: container.querySelector<HTMLButtonElement>("form button")!,
    output: container.querySelector("output")!,
    compose,
  };
}

describe("rendered custom slippage settings", () => {
  it.each([" ", "\u00a0"])("keeps typed whitespace %j invalid and opts out of Auto", async (draft) => {
    const { input, button, output, compose } = await mountSettings();
    expect(button.disabled).toBe(false);
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, draft);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: draft }));
    });
    expect(input.value).toBe(draft);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(output.dataset.auto).toBe("false");
    expect(button.disabled).toBe(true);
    await act(() => { container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(compose).not.toHaveBeenCalled();

    const auto = [...document.querySelectorAll("button")].find((node) => node.textContent === "Auto")!;
    await act(() => { auto.click(); });
    expect(input.value).toBe("");
    expect(output.dataset.auto).toBe("true");
    expect(button.disabled).toBe(false);
    await act(() => { button.click(); });
    expect(compose).toHaveBeenCalledWith(1);
  });

  it("blocks an invalid saved draft even if the old Auto flag is still true", async () => {
    const { input, button, compose } = await mountSettings(" ");
    expect(input.value).toBe(" ");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(button.disabled).toBe(true);
    await act(() => { container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(compose).not.toHaveBeenCalled();
  });
});

function FeeConsumer() {
  const { customFee, swapSettingsValid } = useSwapSettings();
  return <output>{customFee ?? "auto"}:{String(swapSettingsValid)}</output>;
}

describe("trade settings fee rate", () => {
  it.each([
    ["0.1", "0.1:true"],
    ["1.56", "1.56:true"],
    ["0", "0:true"],
    ["", "auto:true"],
    ["500", "500:true"],
    ...["600", "-5", "1e5", "0,5", "NaN", "1.", "0.000000001"].map((draft) => [draft, "auto:false"]),
  ])("exposes the stored %s sat/vB rate as %s", (typed, expected) => {
    snapshot.customFeeRate = typed;
    const html = renderToStaticMarkup(
      <SWRConfig value={{ provider: () => new Map(), revalidateOnMount: false }}>
        <SwapSettingsProvider><FeeConsumer /></SwapSettingsProvider>
      </SWRConfig>,
    );
    expect(html).toBe(`<output>${expected}</output>`);
  });
});
