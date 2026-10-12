/**
 * How the objects of each category are shown, and whether they can be selected (V5 step 6,
 * D71): visible, faded (very transparent, out of the way) or hidden; remembered per browser.
 * Why per category: the objects drawn over the tiles get in the way, and one wants only the
 * lights, or the clutter out of sight, while building.
 */
import { PREF_KEYS, getPref, setPref } from '$lib/fs';
import { OBJECT_CATEGORIES, type ObjectCategory } from '$lib/level/objects';
import type { OpaqueDisplay } from '$lib/render';

export interface CategorySettings {
  display: OpaqueDisplay;
  selectable: boolean;
}

/** Markers and sounds start faded: invisible in game, they only clutter the view. */
const DEFAULTS: Record<ObjectCategory, CategorySettings> = Object.fromEntries(
  OBJECT_CATEGORIES.map((c) => [
    c,
    { display: c === 'marker' || c === 'sound' ? 'faded' : 'visible', selectable: true },
  ]),
) as Record<ObjectCategory, CategorySettings>;

function load(): Record<ObjectCategory, CategorySettings> {
  try {
    const saved = JSON.parse(getPref(PREF_KEYS.objectDisplay) ?? '{}') as Partial<
      Record<ObjectCategory, Partial<CategorySettings>>
    >;
    return Object.fromEntries(
      OBJECT_CATEGORIES.map((c) => [c, { ...DEFAULTS[c], ...saved[c] }]),
    ) as Record<ObjectCategory, CategorySettings>;
  } catch {
    return { ...DEFAULTS };
  }
}

class ObjectDisplay {
  settings = $state(load());

  /** The display of each category, for the scene. */
  get display(): Record<string, OpaqueDisplay> {
    return Object.fromEntries(OBJECT_CATEGORIES.map((c) => [c, this.settings[c].display]));
  }

  set(category: ObjectCategory, patch: Partial<CategorySettings>): void {
    this.settings = { ...this.settings, [category]: { ...this.settings[category], ...patch } };
    setPref(PREF_KEYS.objectDisplay, JSON.stringify(this.settings));
  }
}

export const objectDisplay = new ObjectDisplay();
