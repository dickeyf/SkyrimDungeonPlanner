<script lang="ts">
  /**
   * What a page needing the game folder shows until the session is ready: the folder is
   * restored asynchronously at start-up, so a page opened directly (browser reload) first
   * sees it "restoring" rather than "not configured".
   */
  import { session } from '$lib/session/session.svelte';
</script>

{#if session.status === 'idle' || session.status === 'restoring'}
  <p class="hint">Opening the game folder...</p>
{:else if session.status === 'needs-permission'}
  <p class="warn">{session.message} Grant access in <a href="#/setup">Setup</a>.</p>
{:else if session.status === 'error'}
  <p class="err">{session.message} See <a href="#/setup">Setup</a>.</p>
{:else}
  <p class="warn">Configure the game folder first (<a href="#/setup">Setup</a>).</p>
{/if}

<style>
  .hint {
    color: var(--fg-muted);
  }
</style>
