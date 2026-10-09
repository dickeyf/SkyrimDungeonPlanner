import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

if (import.meta.env.DEV) void import('./lib/session/devProbe').then((m) => m.installDevProbe());

export default app;
