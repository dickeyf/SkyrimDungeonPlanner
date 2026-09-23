<script lang="ts">
  import { onMount } from 'svelte';
  import { APP_NAME, APP_VERSION } from '$lib/version';
  import { supportsFileSystemAccess } from '$lib/fs';
  import { session } from '$lib/session/session.svelte';
  import CataloguePage from './pages/CataloguePage.svelte';
  import HomePage from './pages/HomePage.svelte';
  import SetupPage from './pages/SetupPage.svelte';
  import ValidationPage from './pages/ValidationPage.svelte';

  const supported = supportsFileSystemAccess();
  let route = $state(currentRoute());

  function currentRoute(): string {
    const hash = location.hash.replace(/^#/, '');
    return hash === '' ? '/' : hash;
  }

  onMount(() => {
    const onHash = () => (route = currentRoute());
    window.addEventListener('hashchange', onHash);
    if (supported) void session.restore();
    return () => window.removeEventListener('hashchange', onHash);
  });

  const links = [
    ['/', 'Home'],
    ['/setup', 'Setup'],
    ['/catalogue', 'Catalogue'],
    ['/validation', 'Validation'],
  ] as const;
</script>

<header>
  <span class="brand">{APP_NAME} <small>v{APP_VERSION}</small></span>
  <nav>
    {#each links as [path, label] (path)}
      <a href={`#${path}`} class:active={route === path}>{label}</a>
    {/each}
  </nav>
  <span class="status {session.status}">
    {#if session.status === 'ready' && session.view}
      {session.view.game.picked.name}{session.view.mo2
        ? ` / ${session.view.mo2.layout.profile.name}`
        : ''}
    {:else}
      {session.status}
    {/if}
  </span>
</header>

<main>
  {#if !supported}
    <p class="err">This browser does not expose the File System Access API. Use Chrome or Edge.</p>
  {:else if route === '/setup'}
    <SetupPage />
  {:else if route === '/catalogue'}
    <CataloguePage />
  {:else if route === '/validation'}
    <ValidationPage />
  {:else}
    <HomePage />
  {/if}
</main>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0.5rem 1rem;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border);
  }
  .brand small {
    color: var(--fg-muted);
    font-weight: normal;
  }
  nav a {
    margin-right: 1rem;
    color: var(--fg);
    text-decoration: none;
  }
  nav a.active {
    color: var(--accent);
    border-bottom: 2px solid var(--accent);
  }
  .status {
    margin-left: auto;
    color: var(--fg-muted);
    font-size: 13px;
  }
  .status.ready {
    color: #8fd18f;
  }
  .status.error,
  .status.needs-permission {
    color: #e07a7a;
  }
  main {
    padding: 1rem;
  }
</style>
