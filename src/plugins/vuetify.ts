// Vuetify is the application chrome (toolbar/sidebar/progress/error/empty
// states/dialogs/theme) only. It must NOT be used inside the PDF render layers
// (canvas/text/overlay). See steering: tech.md.
import 'vuetify/styles'
import '@mdi/font/css/materialdesignicons.css'

import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi'

export const vuetify = createVuetify({
  icons: {
    defaultSet: 'mdi',
    aliases,
    sets: { mdi },
  },
})
