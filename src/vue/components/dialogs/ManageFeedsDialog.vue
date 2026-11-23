<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Manage Feeds</v-card-title>
      <v-card-text>
        <ManageFeedsPanel />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('update:modelValue', false)">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import ManageFeedsPanel from './ManageFeedsPanel.vue';

defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();
</script>
