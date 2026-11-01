<script lang="ts">
  // Раздел окна с заголовком h2. rule — отбить от предыдущего раздела чертой.
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    rule?: boolean;
    children: Snippet;
  }

  let { title, rule = false, children }: Props = $props();

  const id = $props.id();
</script>

<section aria-labelledby={id} class:rule>
  <h2 {id}>{title}</h2>
  {@render children()}
</section>

<style>
  h2 {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 18px 0 10px;
    font: 700 15px var(--ui-font-pixel);
  }
  /* пиксельный маркер перед заголовком */
  h2::before {
    content: '';
    flex: none;
    width: 6px;
    height: 6px;
    background: var(--ui-accent);
    box-shadow: 3px 3px 0 var(--ui-drop);
  }
  section:first-child h2 {
    margin-top: var(--ui-s2);
  }
  .rule {
    margin-top: var(--ui-s2);
    border-top: var(--ui-b) solid var(--ui-line);
  }
</style>
