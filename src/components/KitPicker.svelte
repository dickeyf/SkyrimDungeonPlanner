<script lang="ts">
  /** Chooses the kit the Catalogue and Validation pages show (V4, D68). */
  import { KITS } from '$lib/catalogue/kits';
  import { catalogueStore } from '$lib/session/catalogueStore.svelte';
</script>

<label
  >Kit
  <select
    value={catalogueStore.kit.kit}
    disabled={catalogueStore.busy}
    onchange={(e) => {
      const kit = KITS.find((k) => k.kit === e.currentTarget.value);
      if (kit) catalogueStore.kit = kit;
    }}
  >
    {#each KITS as k (k.kit)}<option value={k.kit}>{k.kit}</option>{/each}
  </select></label
>
