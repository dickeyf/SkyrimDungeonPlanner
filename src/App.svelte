<script lang="ts">
  import { onMount } from 'svelte';
  import { APP_NAME, APP_VERSION } from '$lib/version';
  import { supportsFileSystemAccess } from '$lib/fs';
  import { editorStore as ed } from '$lib/editor/editorStore.svelte';
  import { session } from '$lib/session/session.svelte';
  import EditorPage from './pages/EditorPage.svelte';
  import GettingStartedPage from './pages/GettingStartedPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';

  /** Routes of earlier versions, kept working. */
  const ALIASES: Record<string, string> = {
    '/setup': '/settings',
    '/catalogue': '/settings/catalogue',
    '/validation': '/settings/validation',
  };

  const supported = supportsFileSystemAccess();
  let route = $state(currentRoute());

  function currentRoute(): string {
    const hash = location.hash.replace(/^#/, '');
    const path = hash === '' ? '/' : hash;
    return ALIASES[path] ?? path;
  }

  onMount(() => {
    const onHash = () => (route = currentRoute());
    window.addEventListener('hashchange', onHash);
    if (supported) void session.restore();
    return () => window.removeEventListener('hashchange', onHash);
  });

  // the start page: once set up, go straight to the editor; otherwise, getting started
  $effect(() => {
    if (route !== '/') return;
    const status = session.status;
    if (status === 'idle' || status === 'restoring') return;
    const next = session.ready && ed.rememberedPlugin ? '/editor' : '/start';
    history.replaceState(null, '', `#${next}`);
    route = next;
  });

  const links = [
    ['/editor', 'Editor'],
    ['/settings', 'Settings'],
  ] as const;
</script>

<header>
  <a class="brand" href="#/start">{APP_NAME} <small>v{APP_VERSION}</small></a>
  <nav>
    {#each links as [path, label] (path)}
      <a href={`#${path}`} class:active={route === path || route.startsWith(`${path}/`)}>{label}</a>
    {/each}
  </nav>
  <span class="status {session.status}">
    {#if session.status === 'ready' && session.view}
      {session.view.game.picked.name}{session.view.mo2
        ? ` / ${session.view.mo2.layout.profile.name}`
        : ''}{ed.store ? ` / ${ed.store.name}` : ''}
    {:else}
      {session.status}
    {/if}
  </span>
</header>

<main>
  {#if !supported}
    <p class="err">This browser does not expose the File System Access API. Use Chrome or Edge.</p>
  {:else if route === '/editor'}
    <EditorPage />
  {:else if route.startsWith('/settings')}
    <SettingsPage {route} />
  {:else if route === '/start'}
    <GettingStartedPage />
  {:else}
    <p class="hint">Opening the game folder...</p>
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
  .brand {
    color: var(--fg);
    text-decoration: none;
    font-weight: 600;
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
  .hint {
    color: var(--fg-muted);
  }
</style>
