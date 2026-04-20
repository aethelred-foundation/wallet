/**
 * Storybook preview — applies decorators that exercise BOTH themes
 * and the extension's popup viewport sizes (400×620 + 420×640).
 *
 * Every story runs once per theme via Storybook's `globals.theme`
 * toolbar; visual regression captures both variants and diffs against
 * `__image_snapshots__/`.
 */

import type { Preview } from "@storybook/react";
import React from "react";

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    viewport: {
      viewports: {
        popupSmall: {
          name: "Popup (400×620)",
          styles: { width: "400px", height: "620px" },
        },
        popupLarge: {
          name: "Popup (420×640)",
          styles: { width: "420px", height: "640px" },
        },
      },
      defaultViewport: "popupSmall",
    },
    backgrounds: {
      default: "surface",
      values: [
        { name: "surface", value: "#0a0a0b" },
        { name: "light", value: "#fafafa" },
      ],
    },
  },
  globalTypes: {
    theme: {
      description: "Global theme for components",
      defaultValue: "dark",
      toolbar: {
        title: "Theme",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
    locale: {
      description: "i18n locale",
      defaultValue: "en-US",
      toolbar: {
        icon: "globe",
        items: [
          { value: "en-US", title: "English (US)" },
          { value: "fr-FR", title: "French" },
          { value: "ja-JP", title: "Japanese" },
        ],
      },
    },
  },
  decorators: [
    (Story, ctx) => {
      const theme = (ctx.globals.theme as string) ?? "dark";
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-theme", theme);
      }
      return React.createElement(
        "div",
        {
          "data-theme": theme,
          style: {
            padding: "16px",
            minHeight: "100vh",
            background: theme === "dark" ? "#0a0a0b" : "#fafafa",
            color: theme === "dark" ? "#eee" : "#111",
          },
        },
        React.createElement(Story),
      );
    },
  ],
};

export default preview;
