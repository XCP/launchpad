import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";
import {
  SwapSettingsProvider,
  useSwapSettings,
} from "../apps/web/src/app/[lang]/swap/_components/swap-settings";

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
