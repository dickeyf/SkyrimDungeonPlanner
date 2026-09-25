<script lang="ts">
  /**
   * First run: the three things the editor needs, each checked off as soon as it is done, with
   * its controls in place (the same ones as in Settings).
   */
  import FolderSettings from '../components/FolderSettings.svelte';
  import WorkingPluginSettings from '../components/WorkingPluginSettings.svelte';
  import { editorStore as ed } from '$lib/editor/editorStore.svelte';
  import { session } from '$lib/session/session.svelte';
  import { APP_NAME } from '$lib/version';

  const folderDone = $derived(session.ready);
  const pluginDone = $derived(!!ed.store);
</script>

<section>
  <h2>Getting started</h2>
  <p>
    {APP_NAME} assembles Skyrim SE dungeons from the Imperial kit on a top-down grid and writes them into
    your plugin. It runs entirely in this browser: your game folder is read in place, nothing is uploaded.
  </p>

  <ol class="steps">
    <li class:done={folderDone}>
      <h3><span class="check">{folderDone ? '✓' : '1'}</span> Your game</h3>
      <p class="hint">
        Choose the Skyrim SE folder. If you use Mod Organizer 2, also choose its instance folder, so
        the tool sees the game as your MO2 profile does.
      </p>
      <FolderSettings />
    </li>

    <li class:done={pluginDone} class:locked={!folderDone}>
      <h3><span class="check">{pluginDone ? '✓' : '2'}</span> Your plugin</h3>
      {#if folderDone}
        <p class="hint">
          Pick the plugin to build in, or create a new one. Keep it closed in the Creation Kit while
          you edit here, or reload it there after saving.
        </p>
        <WorkingPluginSettings />
      {:else}
        <p class="hint">After step 1.</p>
      {/if}
    </li>

    <li class:locked={!pluginDone}>
      <h3><span class="check">3</span> Build</h3>
      {#if pluginDone}
        <p class="hint">
          The first opening analyses the kit's pieces (about ten seconds, then cached). Click an
          orange open face to add a piece that fits.
        </p>
        <a class="go" href="#/editor">Open the editor</a>
      {:else}
        <p class="hint">After step 2.</p>
      {/if}
    </li>
  </ol>
</section>

<style>
  section {
    max-width: 52rem;
  }
  .steps {
    list-style: none;
    padding: 0;
  }
  .steps > li {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0.4rem 1rem 0.8rem;
    margin-bottom: 0.8rem;
  }
  .steps > li.done {
    border-color: #4f7f4f;
  }
  .steps > li.locked {
    opacity: 0.6;
  }
  h3 {
    margin: 0.4rem 0;
  }
  .check {
    display: inline-block;
    width: 1.5rem;
    height: 1.5rem;
    line-height: 1.5rem;
    text-align: center;
    border-radius: 50%;
    border: 1px solid var(--border);
    margin-right: 0.4rem;
    font-size: 13px;
  }
  .done .check {
    background: #4f7f4f;
    border-color: #4f7f4f;
    color: white;
  }
  .hint {
    color: var(--fg-muted);
  }
  .go {
    display: inline-block;
    padding: 0.4rem 1rem;
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--accent);
    text-decoration: none;
    font-weight: 600;
  }
</style>
