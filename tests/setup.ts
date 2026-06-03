// jsdom does not implement ResizeObserver, which Vuetify's layout composables
// (used by <v-app>) require. Provide a no-op stub so chrome components mount in
// the test environment.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverStub
}
