import { expect, test } from '@playwright/test'

const routes = [
  ['Overview', 'Executive Overview'],
  ['Live Spectrum', 'Live Spectrum'],
  ['Smart Scheduler', 'Smart Scheduler'],
  ['Model Comparison', 'Model Comparison'],
  ['Energy Efficiency', 'Energy Efficiency'],
  ['SDR Integration', 'SDR Integration'],
]

for (const viewport of [{ width: 1886, height: 962 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`navigation and 3D scenes at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('http://127.0.0.1:5173/')
    const nav = page.getByRole('navigation', { name: 'Primary navigation' })
    for (const [label, heading] of routes) {
      await nav.getByRole('button', { name: new RegExp(label) }).click()
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()
      await expect(page.locator('canvas')).toBeVisible()
      await expect.poll(() => page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
        const sample = document.createElement('canvas')
        sample.width = sample.height = 64
        const ctx = sample.getContext('2d')!
        ctx.drawImage(canvas, 0, 0, 64, 64)
        const data = ctx.getImageData(0, 0, 64, 64).data
        let lit = 0
        for (let i = 0; i < data.length; i += 4) {
          if (Math.max(data[i], data[i + 1], data[i + 2]) > 45) lit++
        }
        return lit
      })).toBeGreaterThan(40)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      if (label === 'SDR Integration') {
        await page.locator('.rf-viewport-shell').scrollIntoViewIfNeeded()
        const frame = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
        await page.waitForTimeout(350)
        expect(await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).not.toBe(frame)
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      const target = nav.getByRole('button', { name: /Overview/ })
      const bounds = await target.boundingBox()
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.y + bounds!.height).toBeLessThan(viewport.height)
      expect(await target.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      })).toBe(true)
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.getByRole('button', { name: 'Back to Overview', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Executive Overview', exact: true })).toBeVisible()
    await page.locator('canvas').waitFor()
    await page.waitForTimeout(500)
    const frame = () => page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
    const moving = await frame()
    await page.waitForTimeout(350)
    expect(await frame()).not.toBe(moving)
    await page.getByRole('button', { name: 'Pause animation', exact: true }).click()
    await page.waitForTimeout(500)
    const paused = await frame()
    await page.waitForTimeout(350)
    expect(await frame()).toBe(paused)
    await page.screenshot({ path: test.info().outputPath('overview.png') })
    await nav.getByRole('button', { name: /SDR Integration/ }).click()
    await expect(page.locator('.rf-viewport-shell canvas')).toBeVisible()
    await page.locator('.rf-viewport-shell').scrollIntoViewIfNeeded()
    await page.screenshot({ path: test.info().outputPath('sdr.png') })
    await page.getByRole('button', { name: 'Connect Mock SDR', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Connect Mock SDR', exact: true })).toBeEnabled()
    expect(errors).toEqual([])
  })
}

test('reduced motion keeps the scene static and navigation available', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('http://127.0.0.1:5173/')
  await expect(page.getByRole('button', { name: 'Resume animation' })).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()
  await page.waitForTimeout(500)
  const frame = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  await page.waitForTimeout(400)
  expect(await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(frame)
  await page.getByRole('navigation').getByRole('button', { name: /SDR Integration/ }).click()
  await page.getByRole('button', { name: 'Back to Overview', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Executive Overview', exact: true })).toBeVisible()
})
