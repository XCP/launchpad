// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MintDeadline } from "@/app/[lang]/[asset]/_components/mint-deadline";
import type { RoomState } from "@/app/[lang]/[asset]/_components/launch-room";

const live = vi.hoisted(() => ({ height: 900, state: null as RoomState | null, router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => live.router }));
vi.mock("@/hooks/use-chain-height", () => ({ useChainHeight: (_target: number, initial: number) => live.height || initial }));
vi.mock("@/app/[lang]/[asset]/_components/launch-room", () => ({ useLaunchRoom: () => ({ state: live.state }) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  live.height = 900;
  live.state = null;
  live.router.refresh.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const render = (initialHeight = 900, deadlineBlock = 1000, allOrNothing = true) => act(() => root.render(
  <MintDeadline deadlineBlock={deadlineBlock} initialHeight={initialHeight} initialEarned="0" target="6900000000000000" allOrNothing={allOrNothing} />,
));

describe("mint deadline", () => {
  it("shows an approximate deadline even before anyone mints, and follows parsed height", async () => {
    await render();
    expect(container.textContent).toContain("Time remaining");
    expect(container.textContent).toContain("~17h left");
    expect(container.textContent).toContain("100 blocks");
    expect(container.textContent).toContain("Closes at block 1,000, or earlier if sold out.");
    expect(container.textContent).toContain("If it fails, every minter’s XCP is automatically refunded.");
    live.height = 999;
    await render();
    expect(container.textContent).toContain("~10m left");
    expect(container.textContent).toContain("1 block");
    expect(live.router.refresh).not.toHaveBeenCalled();
  });

  it.each([1000, 1003])("refreshes for settlement at parsed height %s without showing negative time", async (height) => {
    live.height = height;
    await render();
    expect(container.textContent).toContain("Sale closing");
    expect(container.textContent).not.toContain("left");
    expect(live.router.refresh).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTime(15_000));
    expect(live.router.refresh).toHaveBeenCalledTimes(2);
    await act(() => root.render(null));
    await act(() => vi.advanceTimersByTime(15_000));
    expect(live.router.refresh).toHaveBeenCalledTimes(2);
  });

  it.each([
    { status: "closed", earned_quantity: "100000000000000" },
    { status: "open", earned_quantity: "6900000000000000" },
  ])("suppresses the original deadline after confirmed resolution: %s", async (state) => {
    live.state = { ...state, paid_quantity: "0", pending_count: 0, pending_quantity: "0", pending: [] };
    await render();
    expect(container.textContent).toContain("Sale closing");
    expect(container.textContent).not.toContain("left");
    expect(live.router.refresh).toHaveBeenCalledTimes(state.status === "closed" ? 0 : 1);
  });

  it("does not treat a full pending mint as a confirmed sellout", async () => {
    live.state = { status: "open", earned_quantity: "0", paid_quantity: "0", pending_count: 1, pending_quantity: "6900000000000000", pending: [] };
    await render();
    expect(container.textContent).toContain("~17h left");
    expect(live.router.refresh).not.toHaveBeenCalled();
  });

  it("hands refreshes to the room status listener when a confirmed sellout closes", async () => {
    live.state = { status: "open", earned_quantity: "6900000000000000", paid_quantity: "69000000000", pending_count: 0, pending_quantity: "0", pending: [] };
    await render();
    expect(live.router.refresh).toHaveBeenCalledTimes(1);
    live.state = { ...live.state, status: "closed" };
    await render();
    await act(() => vi.advanceTimersByTime(30_000));
    expect(live.router.refresh).toHaveBeenCalledTimes(1);
  });

  it("uses the exact deadline without inventing an ETA when height is unavailable", async () => {
    live.height = 0;
    await render(0);
    expect(container.textContent).toContain("Block 1,000");
    expect(container.textContent).not.toContain("left");
    expect(live.router.refresh).not.toHaveBeenCalled();
  });

  it("does not show a deadline for an unbounded mint", async () => {
    await render(900, 0);
    expect(container.textContent).toBe("");
    expect(live.router.refresh).not.toHaveBeenCalled();
  });

  it("does not promise a full refund for a mint without all-or-nothing terms", async () => {
    await render(900, 1000, false);
    expect(container.textContent).toContain("Closes at block 1,000");
    expect(container.textContent).not.toContain("XCP is automatically refunded");
  });
});
