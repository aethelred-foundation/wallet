export const IS_PRODUCTION_BUILD = import.meta.env.PROD;
export const IS_DEVELOPMENT_BUILD = import.meta.env.DEV;
export const IS_NON_PRODUCTION_BUILD = !IS_PRODUCTION_BUILD;
