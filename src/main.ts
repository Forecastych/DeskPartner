import { getCurrentWindow } from '@tauri-apps/api/window';
import { mount, type Component } from 'svelte';
import './app.css';
import App from './App.svelte';
import Bowl from './Bowl.svelte';
import Laser from './Laser.svelte';
import PetMenu from './PetMenu.svelte';
import Push from './Push.svelte';
import Settings from './Settings.svelte';
import Setup from './Setup.svelte';

// Все окна грузят одну страницу, а что в нём жить — решает метка окна, которую дал Rust.
const views: Record<string, Component> = {
  pet: App,
  bowl: Bowl,
  setup: Setup,
  settings: Settings,
  menu: PetMenu,
  laser: Laser,
  push: Push,
};

export default mount(views[getCurrentWindow().label] ?? App, { target: document.getElementById('app')! });
