<script setup lang="ts">
/**
 * 薄いルートシェル（design.md「App.vue ... <v-app> でラップし PdfViewer を載せる」）。
 *
 * Vuetify がアプリケーションのクロームを提供するため `<v-app>` でツリーを包み、
 * その配下に画面オーケストレータ `PdfViewer` を載せるだけに留める。実際の結線・
 * status 出し分け・読み込みライフサイクルは `PdfViewer`（task 5.1）が所有する。
 */
import PdfViewer from '@/components/PdfViewer.vue'
</script>

<template>
  <v-app>
    <PdfViewer />
  </v-app>
</template>
