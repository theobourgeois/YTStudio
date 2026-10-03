export const APP_ICONS = [
  { id: "original", name: "Original", description: "White and purple" },
  { id: "banner-blue", name: "Banner blue", description: "Blue, gold and crimson" },
  { id: "banner-red", name: "Banner red", description: "Crimson, gold and blue" },
  { id: "saffron", name: "Saffron", description: "Yellow, red and cobalt" },
  { id: "midnight", name: "Midnight", description: "Navy, gold and ivory" },
  { id: "parchment", name: "Parchment", description: "Ivory, gold and burgundy" },
  { id: "evergreen", name: "Evergreen", description: "Green, gold and ivory" },
] as const;

export type AppIconId = (typeof APP_ICONS)[number]["id"];

export function isAppIconId(value: unknown): value is AppIconId {
  return APP_ICONS.some(({ id }) => id === value);
}

export const appIconUrl = (id: AppIconId) => `/app-icons/${id}.png`;
