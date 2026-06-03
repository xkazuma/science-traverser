<script setup lang="ts"></script>

<template>
  <!--
    Thin root shell. Vuetify provides the application chrome and must wrap the
    tree in <v-app>. The <v-btn> + MDI icon below only prove that Vuetify and
    @mdi/font are wired; real chrome (toolbar/sidebar/etc.) arrives in later
    tasks. PDF render layers stay outside Vuetify.
  -->
  <v-app>
    <main>
      <h1>PDF Viewer</h1>
      <v-btn prepend-icon="mdi-file-pdf-box">
        <v-icon icon="mdi-file-pdf-box" />
        Open PDF
      </v-btn>
    </main>
  </v-app>
</template>
