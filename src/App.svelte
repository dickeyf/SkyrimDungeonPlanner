<script lang="ts">
  import { APP_NAME, APP_VERSION } from '$lib/version';

  const supportsFileSystemAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
</script>

<main>
  <h1>{APP_NAME} <small>v{APP_VERSION}</small></h1>
  <p>
    Project skeleton. See <code>docs/07-plan-v1.md</code> for the steps toward V1 (Imperial kit, single
    Z level).
  </p>
  {#if !supportsFileSystemAccess}
    <p class="warn">
      This browser does not expose the File System Access API. Use Chrome or Edge (see D43).
    </p>
  {/if}
  <h2>Proof-of-concept pages</h2>
  <p>The <code>poc/*.html</code> pages are served under <code>/poc/</code> (phase 0).</p>
  <ul>
    <li>
      <a href="/poc/r14a-fs.html">R14a - disk access</a>: pick the game folder, restore it after a
      reload, ranged read, write in place.
    </li>
    <li>
      <a href="/poc/r15-mo2.html">R15 - MO2 overlay</a>: rebuild the virtual Data folder from an MO2
      instance, resolve plugins and archives.
    </li>
    <li>
      <a href="/poc/r14b-bsa-nif.html">R14b - BSA + NIF + WebGL</a>: read a tile straight from the
      archive (ranged reads, LZ4) and draw it on the 128 grid.
    </li>
    <li>
      <a href="/poc/r14c-esp.html">R14c - plugin in place</a>: parse a plugin, write it back
      byte-identical, add a reference to a copy for xEdit / CK checks.
    </li>
    <li>
      <a href="/poc/r10-grid.html">R10 - grid derivation</a>: recognize kit tiles in an existing
      cell, find the grid anchor, list what stays opaque.
    </li>
  </ul>
</main>

<style>
  main {
    max-width: 48rem;
    margin: 0 auto;
    padding: 2rem 1rem;
  }
  h1 small {
    color: var(--fg-muted);
    font-weight: normal;
    font-size: 0.6em;
  }
  .warn {
    border: 1px solid var(--accent);
    padding: 0.5rem 0.75rem;
    border-radius: 4px;
  }
</style>
