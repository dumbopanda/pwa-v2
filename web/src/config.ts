// Set per build: "Spend Roll" for prod, "Spend Roll Dev" for dev (VITE_APP_NAME).
// The && guard: vite.config.ts imports this file in Node, where import.meta.env is unset.
// (Not ?. -- Vite only swaps in the literal `import.meta.env.VITE_APP_NAME`.)
export const DEFAULT_APP_NAME = "Spend Roll";
export const APP_NAME: string = (import.meta.env && import.meta.env.VITE_APP_NAME) || DEFAULT_APP_NAME;
export const THEME = "#F4F1EA";
export const DEFAULT_CURRENCY = "INR";
/** A short list so nobody scrolls 160 codes. An account's current currency is always kept. */
export const COMMON_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY", "SAR"];
export const currencyList = (current?: string) => (current && !COMMON_CURRENCIES.includes(current) ? [...COMMON_CURRENCIES, current] : COMMON_CURRENCIES);
