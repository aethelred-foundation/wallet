/**
 * Storybook 8 (Vite-based) main configuration for the Aethelred Wallet
 * component gallery + visual regression test target.
 *
 * All stories live under `apps/extension/src/popup/components/**` so
 * CI can reuse the exact files that ship; there is no parallel
 * "design-system" folder.
 */

import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  stories: [
    "../apps/extension/src/popup/components/**/*.stories.@(ts|tsx)",
    "../apps/extension/src/popup/views/**/*.stories.@(ts|tsx)",
  ],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-a11y",
    "@storybook/addon-interactions",
  ],
  features: {
    /*
     * storyStoreV7 lazy-loads each story instead of shipping one giant
     * bundle. Required for on-demand visual regression runs. See:
     * https://storybook.js.org/docs/api/main-config/main-config-features
     */
    storyStoreV7: true,
  },
  docs: {
    autodocs: "tag",
  },
  typescript: {
    reactDocgen: "react-docgen-typescript",
  },
};

export default config;
