import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

const POPUP_VIEWPORT = { width: 460, height: 600 };

interface PopupLayout {
  documentWidth: number;
  documentHeight: number;
  documentScrollWidth: number;
  documentScrollHeight: number;
  bodyOverflow: string;
  shell: { width: number; height: number };
  canvas: { right: number; bottom: number };
}

async function readPopupLayout(page: Page) {
  return page.evaluate<PopupLayout>(() => {
    const shell = document.querySelector<HTMLElement>(".popup-shell");
    const canvas = document.querySelector<HTMLElement>(".canvas");
    if (!shell || !canvas) throw new Error("Popup shell did not render");

    const shellRect = shell.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const root = document.documentElement;

    return {
      documentWidth: root.clientWidth,
      documentHeight: root.clientHeight,
      documentScrollWidth: root.scrollWidth,
      documentScrollHeight: root.scrollHeight,
      bodyOverflow: getComputedStyle(document.body).overflow,
      shell: { width: shellRect.width, height: shellRect.height },
      canvas: { right: canvasRect.right, bottom: canvasRect.bottom },
    };
  });
}

test("browser action fits Chrome's popup boundary without page scrollbars", async ({
  approvedPage,
}) => {
  await approvedPage.setViewportSize(POPUP_VIEWPORT);
  await approvedPage.reload();
  await expect(approvedPage.locator(".popup-shell")).toBeVisible();

  const layout = await readPopupLayout(approvedPage);
  expect(layout.documentWidth).toBe(POPUP_VIEWPORT.width);
  expect(layout.documentHeight).toBe(POPUP_VIEWPORT.height);
  expect(layout.documentScrollWidth).toBe(POPUP_VIEWPORT.width);
  expect(layout.documentScrollHeight).toBe(POPUP_VIEWPORT.height);
  expect(layout.bodyOverflow).toBe("hidden");
  expect(layout.shell).toEqual(POPUP_VIEWPORT);
  expect(layout.canvas.right).toBeLessThanOrEqual(POPUP_VIEWPORT.width);
  expect(layout.canvas.bottom).toBeLessThanOrEqual(POPUP_VIEWPORT.height);

  const view = approvedPage.locator(".view-container");
  await expect(view).toHaveCSS("overflow-y", "auto");
});

test("released home actions fill the available row", async ({ approvedPage }) => {
  await approvedPage.setViewportSize(POPUP_VIEWPORT);
  await approvedPage.reload();

  const actions = approvedPage.locator(".v2-actions-grouped > .v2-action");
  await expect(actions).toHaveCount(3);
  await expect(actions.first()).toBeVisible();

  const columnCount = await approvedPage.locator(".v2-actions-grouped").evaluate(
    (element) =>
      getComputedStyle(element)
        .gridTemplateColumns.split(" ")
        .filter((track) => Number.parseFloat(track) > 0).length,
  );
  expect(columnCount).toBe(await actions.count());
});

test("bottom navigation grid and active indicator share the released tab count", async ({
  approvedPage,
}) => {
  await approvedPage.setViewportSize(POPUP_VIEWPORT);
  await approvedPage.reload();

  const navigation = approvedPage.getByRole("tablist", { name: /main navigation/i });
  const tabs = navigation.getByRole("tab");
  await expect(tabs).toHaveCount(4);

  const payments = navigation.getByRole("tab", { name: /payments/i });
  await payments.click();
  await expect(payments).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() =>
      navigation.evaluate((element) => {
        const activeTab = element.querySelector<HTMLElement>(".nav-tab.active");
        const indicator = element.querySelector<HTMLElement>(".nav-pill-bg");
        if (!activeTab || !indicator) return Number.POSITIVE_INFINITY;
        return Math.abs(
          activeTab.getBoundingClientRect().left -
            indicator.getBoundingClientRect().left,
        );
      }),
    )
    .toBeLessThan(1);

  const layout = await navigation.evaluate((element) => {
    const activeTab = element.querySelector<HTMLElement>(".nav-tab.active");
    const indicator = element.querySelector<HTMLElement>(".nav-pill-bg");
    if (!activeTab || !indicator) {
      throw new Error("Active navigation geometry did not render");
    }

    const activeRect = activeTab.getBoundingClientRect();
    const indicatorRect = indicator.getBoundingClientRect();
    const renderedColumns = getComputedStyle(element)
      .gridTemplateColumns.split(" ")
      .filter((track) => Number.parseFloat(track) > 0).length;

    return {
      renderedColumns,
      active: {
        left: activeRect.left,
        right: activeRect.right,
        width: activeRect.width,
      },
      indicator: {
        left: indicatorRect.left,
        right: indicatorRect.right,
        width: indicatorRect.width,
      },
    };
  });

  expect(layout.renderedColumns).toBe(await tabs.count());
  expect(layout.indicator.left).toBeCloseTo(layout.active.left, 0);
  expect(layout.indicator.right).toBeCloseTo(layout.active.right, 0);
  expect(layout.indicator.width).toBeCloseTo(layout.active.width, 0);
});
