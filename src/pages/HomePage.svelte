<script lang="ts">
  import { APP_NAME } from '$lib/version';
  import { session } from '$lib/session/session.svelte';
</script>

<section>
  <h2>{APP_NAME}</h2>
  <p>
    Assemble Skyrim SE dungeons from the modular kits on a top-down grid and write the result back
    into your plugin. Runs entirely in this browser: your game folder is read in place, nothing is
    uploaded.
  </p>
  <ol>
    <li>
      <a href="#/setup">Setup</a>: choose the game folder and, if you use MO2, the instance and
      profile.
    </li>
    <li><a href="#/catalogue">Catalogue</a>: extract the Imperial kit pieces from Skyrim.esm.</li>
    <li>
      <a href="#/validation">Validation</a>: review the connection types before naming and
      validating them.
    </li>
    <li>
      <a href="#/editor">Editor</a>: open a cell of the working plugin (the 3D view and editing
      tools come next).
    </li>
  </ol>
  {#if session.status === 'needs-setup'}
    <p class="warn">{session.message}</p>
  {:else if session.status === 'needs-permission'}
    <p class="warn">{session.message} Go to <a href="#/setup">Setup</a>.</p>
  {/if}

  <h3>Proof-of-concept pages (phase 0)</h3>
  <ul>
    <li><a href="/poc/r14a-fs.html">R14a - disk access</a></li>
    <li><a href="/poc/r15-mo2.html">R15 - MO2 overlay</a></li>
    <li><a href="/poc/r14b-bsa-nif.html">R14b - BSA + NIF + WebGL</a></li>
    <li><a href="/poc/r14c-esp.html">R14c - plugin in place</a></li>
    <li><a href="/poc/r10-grid.html">R10 - grid derivation</a></li>
  </ul>
</section>

<style>
  section {
    max-width: 48rem;
  }
</style>
