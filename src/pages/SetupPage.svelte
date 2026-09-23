<script lang="ts">
  import { editorStore as ed } from '$lib/editor/editorStore.svelte';
  import { session } from '$lib/session/session.svelte';
  import { describeView } from '$lib/session/dataView';

  // list the plugins of the current Data view (and reopen the remembered one) when it changes
  $effect(() => {
    if (session.view) {
      void ed.listPlugins().then(() => {
        if (!ed.store && ed.rememberedPlugin) void ed.openPlugin();
      });
    }
  });

  let busy = $state(false);

  async function run(action: () => Promise<void>): Promise<void> {
    busy = true;
    try {
      await action();
    } catch (error) {
      session.status = 'error';
      session.message = (error as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section>
  <h2>Folders</h2>
  <p class="hint">
    The tool reads the game's own <code>Data</code> folder plus, when you use Mod Organizer 2, the mod
    folders of the chosen profile, exactly as the game would see them. Nothing is copied. A stock game
    folder with the DLC and your own plugin managed as MO2 mods is the typical modder setup.
  </p>

  <div class="row">
    <div>
      <b>Game folder</b>
      <div>{session.gameName ?? 'not set'}</div>
    </div>
    <button disabled={busy} onclick={() => run(() => session.pickGameFolder())}
      >Choose the game folder (or Data)...</button
    >
  </div>

  <div class="row">
    <div>
      <b>MO2 instance</b>
      <div>{session.mo2Name ?? 'not set (optional)'}</div>
    </div>
    <button disabled={busy} onclick={() => run(() => session.pickMo2Instance())}
      >Choose the MO2 instance folder...</button
    >
    {#if session.mo2Name}
      <button disabled={busy} onclick={() => run(() => session.forgetMo2Instance())}>Forget</button>
    {/if}
  </div>

  {#if session.view?.mo2}
    <div class="row">
      <label>
        <b>MO2 profile</b>
        <select
          disabled={busy}
          value={session.view.mo2.layout.profile.name}
          onchange={(e) =>
            run(() => session.setProfile((e.currentTarget as HTMLSelectElement).value))}
        >
          {#each session.view.mo2.profiles as profile (profile)}
            <option>{profile}</option>
          {/each}
        </select>
      </label>
    </div>
  {/if}

  {#if session.view}
    <div class="row">
      <label>
        <b>Working plugin</b>
        <select
          disabled={busy || ed.busy}
          value={ed.store?.name ?? ed.rememberedPlugin ?? ''}
          onchange={(e) => ed.openPlugin((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="" disabled>choose the plugin to edit</option>
          {#each ed.plugins as p (p.name)}
            <option value={p.name}>{p.name} ({p.layer.name})</option>
          {/each}
        </select>
      </label>
      {#if ed.store}<span class="ok">{ed.message}</span>{/if}
      {#if ed.error}<span class="err">{ed.error}</span>{/if}
    </div>
  {/if}

  {#if session.status === 'needs-permission'}
    <p class="warn">
      {session.message}
      <button disabled={busy} onclick={() => run(() => session.reauthorize())}>Re-authorize</button>
    </p>
  {:else if session.status === 'error'}
    <p class="err">{session.message}</p>
  {:else if session.view}
    <p class="ok">{describeView(session.view)}</p>
  {/if}
</section>

<style>
  section {
    max-width: 48rem;
  }
  .row {
    display: flex;
    gap: 1rem;
    align-items: center;
    padding: 0.6rem 0;
    border-top: 1px solid var(--border);
  }
  .row > div:first-child {
    min-width: 14rem;
  }
  .hint {
    color: var(--fg-muted);
  }
</style>
