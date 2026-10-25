<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Keyboard shortcuts</v-card-title>
      <v-card-text>
        <v-table density="compact">
          <tbody>
            <tr v-for="shortcut in shortcuts" :key="shortcut.keys">
              <td class="key-cell"><kbd>{{ shortcut.keys }}</kbd></td>
              <td>{{ shortcut.description }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('update:modelValue', false)">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

const shortcuts = [
  { keys: 'j / ↓', description: 'Next article' },
  { keys: 'k / ↑', description: 'Previous article' },
  { keys: 'Enter', description: 'Open selected article' },
  { keys: 'o / l', description: 'Open article' },
  { keys: 'r', description: 'Toggle read' },
  { keys: 's', description: 'Toggle starred' },
  { keys: 'f', description: 'Toggle published' },
  { keys: 'Shift+G', description: 'Mark current feed as read' },
  { keys: 'u', description: 'Refresh' },
  { keys: '/', description: 'Focus search' },
  { keys: '?', description: 'Show this help' },
];
</script>

<style scoped>
.key-cell {
  width: 120px;
}

kbd {
  padding: 0.1rem 0.35rem;
  border: 1px solid currentColor;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.8rem;
}
</style>
