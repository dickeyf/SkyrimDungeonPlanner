<script lang="ts">
  /** Game folder, MO2 instance and profile: where the tool reads the game data. */
  import { session } from '$lib/session/session.svelte';
  import { describeView } from '$lib/session/dataView';

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

<style>
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
</style>
