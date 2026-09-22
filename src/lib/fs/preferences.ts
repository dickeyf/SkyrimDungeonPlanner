/** Simple per-user preferences in localStorage (D43). Handles go to IndexedDB instead. */

const PREFIX = 'sdp.';

export const PREF_KEYS = {
  mo2Profile: 'mo2Profile',
  workPlugin: 'workPlugin',
} as const;

export function getPref(key: string): string | undefined {
  try {
    return localStorage.getItem(PREFIX + key) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setPref(key: string, value: string | undefined): void {
  try {
    if (value === undefined || value === '') localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // storage unavailable (private mode, blocked): preferences are optional
  }
}
