<script lang="ts">
  /** Settings: sub-pages in a left panel (folders and plugin, kit catalogue, validation). */
  import CataloguePage from './CataloguePage.svelte';
  import DeveloperPage from './DeveloperPage.svelte';
  import SetupPage from './SetupPage.svelte';
  import ValidationPage from './ValidationPage.svelte';

  let { route }: { route: string } = $props();

  const pages = [
    ['/settings', 'Folders and plugin'],
    ['/settings/catalogue', 'Catalogue'],
    ['/settings/validation', 'Validation'],
    ...(import.meta.env.DEV ? [['/settings/developer', 'Developer']] : []),
  ] as [string, string][];
</script>

<div class="settings">
  <nav>
    {#each pages as [path, label] (path)}
      <a href={`#${path}`} class:active={route === path}>{label}</a>
    {/each}
    <a class="start" href="#/start">Getting started</a>
  </nav>
  <div class="page">
    {#if route === '/settings/catalogue'}
      <CataloguePage />
    {:else if route === '/settings/validation'}
      <ValidationPage />
    {:else if route === '/settings/developer' && import.meta.env.DEV}
      <DeveloperPage />
    {:else}
      <SetupPage />
    {/if}
  </div>
</div>

<style>
  .settings {
    display: grid;
    grid-template-columns: 12rem 1fr;
    gap: 1.5rem;
    align-items: start;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    border-right: 1px solid var(--border);
    padding-right: 0.8rem;
  }
  nav a {
    padding: 0.35rem 0.6rem;
    border-radius: 4px;
    color: var(--fg);
    text-decoration: none;
  }
  nav a.active {
    background: var(--bg-panel);
    color: var(--accent);
  }
  nav a.start {
    margin-top: 1rem;
    color: var(--fg-muted);
    font-size: 13px;
  }
  .page {
    min-width: 0;
  }
</style>
