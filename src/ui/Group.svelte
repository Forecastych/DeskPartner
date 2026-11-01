<script lang="ts">
  // Группа полей с подписью: несколько галочек или вариантов, которые читаются вместе.
  import type { Snippet } from 'svelte';

  interface Props {
    legend: string;
    children: Snippet;
  }

  let { legend, children }: Props = $props();
</script>

<fieldset>
  <legend>{legend}</legend>
  {@render children()}
</fieldset>

<style>
  fieldset {
    margin: 0 0 var(--ui-s4);
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 6px;
    padding: 0;
    font-weight: 600;
  }
</style>
