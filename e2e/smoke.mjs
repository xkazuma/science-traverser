import { chromium } from 'playwright'

const URL = process.env.SMOKE_URL || 'http://localhost:4173/'
const PDF = new URL('./fixture-3page.pdf', import.meta.url).pathname
const results = []
let failures = 0
function check(name, cond, detail = '') {
  const ok = !!cond
  if (!ok) failures++
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text()) })

try {
  await page.goto(URL, { waitUntil: 'networkidle' })

  // 1. idle prompt (Req 7.5)
  await page.waitForSelector('[data-test="idle-prompt"]', { timeout: 10000 })
  check('idle prompt shown on load (7.5)', await page.isVisible('[data-test="idle-prompt"]'))

  // 2. open a PDF via the hidden file input (file picker path, Req 1.1)
  await page.setInputFiles('[data-test="file-input"]', PDF)

  // 3. continuous render: a page canvas paints (Req 2.1/2.2)
  await page.waitForSelector('canvas.canvas-layer', { timeout: 15000 })
  await page.waitForTimeout(1500) // let pdfjs raster + text layer settle
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('canvas.canvas-layer')
    if (!c) return { found: false }
    const ctx = c.getContext('2d')
    const { width, height } = c
    const data = ctx.getImageData(0, 0, width, height).data
    let min = 255, max = 0, nonWhite = 0
    for (let i = 0; i < data.length; i += 4) {
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3
      if (v < min) min = v
      if (v > max) max = v
      if (v < 250 || data[i + 3] < 250) nonWhite++
    }
    return { found: true, width, height, min, max, nonWhite }
  })
  check('canvas exists with non-zero size', canvasInfo.found && canvasInfo.width > 0 && canvasInfo.height > 0,
    JSON.stringify(canvasInfo))
  check('canvas actually rendered content (not blank) (2.2)', canvasInfo.found && canvasInfo.nonWhite > 0 && canvasInfo.max - canvasInfo.min > 20,
    `nonWhite=${canvasInfo?.nonWhite}, contrast=${canvasInfo ? canvasInfo.max - canvasInfo.min : 'n/a'}`)

  // 4. selectable text layer present (Req 2.3)
  const spanCount = await page.locator('.text-layer span').count()
  check('text layer has selectable spans (2.3)', spanCount > 0, `spans=${spanCount}`)
  const textContent = (await page.locator('.text-layer').first().innerText().catch(() => '')) || ''
  check('text layer contains page text', /Page 1/.test(textContent) || spanCount > 0, JSON.stringify(textContent.slice(0, 40)))

  // 5. page count shown (Req 3.1)
  const total = (await page.locator('[data-test="page-total"]').first().innerText().catch(() => '')) || ''
  check('page total shows 3 pages (3.1)', /3/.test(total), JSON.stringify(total))

  // 6. navigation: next page updates current page (Req 3.3/3.2)
  await page.click('[data-test="next-page"]')
  await page.waitForTimeout(800)
  const jumpVal = await page.locator('[data-test="page-jump"] input').first().inputValue().catch(async () =>
    await page.locator('[data-test="page-jump"]').first().inputValue().catch(() => ''))
  check('next-page advances current page to 2 (3.3/3.2)', String(jumpVal) === '2', `pageInput=${jumpVal}`)

  // 7. zoom in changes scale (Req 4.1)
  const scaleBefore = (await page.locator('[data-test="scale-percent"]').first().innerText().catch(() => '')) || ''
  await page.click('[data-test="zoom-in"]')
  await page.waitForTimeout(600)
  const scaleAfter = (await page.locator('[data-test="scale-percent"]').first().innerText().catch(() => '')) || ''
  check('zoom-in changes scale (4.1)', scaleBefore !== scaleAfter, `before=${scaleBefore} after=${scaleAfter}`)

  // 8. fit-width does not crash and keeps a canvas (Req 4.3)
  await page.click('[data-test="fit-width"]')
  await page.waitForTimeout(800)
  check('fit-width keeps a rendered canvas (4.3)', (await page.locator('canvas.canvas-layer').count()) > 0)

  // 9. error path: open a non-PDF -> error/invalid handling (Req 1.4/7)
  // (reload to idle, then feed a text file)
  await page.evaluate(() => location.reload())
  await page.waitForSelector('[data-test="idle-prompt"]', { timeout: 10000 })
  const fs = await import('node:fs')
  const os = await import('node:os')
  const notPdf = os.tmpdir() + '/pdfsmoke-notpdf.txt'
  fs.writeFileSync(notPdf, 'this is not a pdf')
  await page.setInputFiles('[data-test="file-input"]', notPdf)
  await page.waitForTimeout(500)
  const errVisible = await page.isVisible('[data-test="error-alert"]').catch(() => false)
  check('non-PDF shows error alert (1.4/7)', errVisible)

  await page.screenshot({ path: os.tmpdir() + '/pdfsmoke-screenshot.png', fullPage: false }).catch(() => {})
} catch (e) {
  check('smoke script ran without throwing', false, String(e))
} finally {
  check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  await browser.close()
}

console.log('\n==== E2E SMOKE RESULTS ====')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'} (${results.length} checks)`)
process.exit(failures === 0 ? 0 : 1)
