<script lang="ts">
  import FolderSettings from '../components/FolderSettings.svelte';
  import WorkingPluginSettings from '../components/WorkingPluginSettings.svelte';
</script>

<section>
  <h2>Folders and plugin</h2>
  <p class="hint">
    The tool reads the game's own <code>Data</code> folder plus, when you use Mod Organizer 2, the mod
    folders of the chosen profile, exactly as the game would see them. Nothing is copied. A stock game
    folder with the DLC and your own plugin managed as MO2 mods is the typical modder setup.
  </p>
  <FolderSettings />
  <WorkingPluginSettings />
</section>

<style>
  section {
    max-width: 48rem;
  }
  .hint {
    color: var(--fg-muted);
  }
</style>
