import { getCurrentWindow } from '@tauri-apps/api/window';
import { mount, type Component } from 'svelte';
import './app.css';
import App from './App.svelte';
import Bed from './Bed.svelte';
import Bowl from './Bowl.svelte';
import Bubble from './Bubble.svelte';
import Laser from './Laser.svelte';
import Mouse from './Mouse.svelte';
import PetMenu from './PetMenu.svelte';
import Puddle from './Puddle.svelte';
import Push from './Push.svelte';
import Settings from './Settings.svelte';
import Setup from './Setup.svelte';
import Stats from './Stats.svelte';

// Все окна грузят одну страницу, а что в нём жить — решает метка окна, которую дал Rust.
const views: Record<string, Component> = {
  pet: App,
  bowl: Bowl,
  bed: Bed,
  setup: Setup,
  settings: Settings,
  stats: Stats,
  menu: PetMenu,
  bubble: Bubble,
  laser: Laser,
  push: Push,
  mouse: Mouse,
  puddle: Puddle,
};

export default mount(views[getCurrentWindow().label] ?? App, { target: document.getElementById('app')! });
