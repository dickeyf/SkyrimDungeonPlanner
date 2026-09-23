<script lang="ts">
  /**
   * Draws face profiles (segments [u1, v1, u2, v2] in units, u to the right seen from
   * outside, v up) as SVG. Several profiles overlay in different colors for comparison.
   */
  import type { Profile } from '$lib/mesh/profiles';

  interface Layer {
    segments: Profile;
    color: string;
    label?: string;
  }

  let { layers, size = 180 }: { layers: Layer[]; size?: number } = $props();

  const box = $derived.by(() => {
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const layer of layers) {
      for (const s of layer.segments) {
        uMin = Math.min(uMin, s[0]!, s[2]!);
        uMax = Math.max(uMax, s[0]!, s[2]!);
        vMin = Math.min(vMin, s[1]!, s[3]!);
        vMax = Math.max(vMax, s[1]!, s[3]!);
      }
    }
    if (!Number.isFinite(uMin)) return { x: -1, y: -1, w: 2, h: 2 };
    const pad = 12;
    return { x: uMin - pad, y: -(vMax + pad), w: uMax - uMin + 2 * pad, h: vMax - vMin + 2 * pad };
  });
</script>

<svg
  width={size}
  height={size}
  viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
  preserveAspectRatio="xMidYMid meet"
  role="img"
  aria-label="face profile"
>
  <line x1={box.x} y1="0" x2={box.x + box.w} y2="0" class="axis" />
  <line x1="0" y1={box.y} x2="0" y2={box.y + box.h} class="axis" />
  {#each layers as layer, li (li)}
    {#each layer.segments as s, si (si)}
      <line
        x1={s[0]}
        y1={-s[1]!}
        x2={s[2]}
        y2={-s[3]!}
        stroke={layer.color}
        stroke-width={(Math.max(box.w, box.h) / 150) * (layers.length > 1 && li === 0 ? 3 : 1)}
        stroke-linecap="round"
      />
    {/each}
  {/each}
</svg>

<style>
  svg {
    background: #16151b;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
  .axis {
    stroke: #3d3b47;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
</style>
