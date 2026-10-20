import { expect, test } from '@playwright/test'
import { secp256k1 } from '@noble/curves/secp256k1'
import { legacyMessageHash } from '@xcp/wallet-sdk'

const route = '/es/profile'
const enabled = process.env.CASATOOKAN_TEST_ENABLED !== 'false'
const address = 'bc1qvux25709r4uw6rzc8wyl7wwecjdhrx085hm5ty'
const publicKey = '0256b328b30c8bf5839e24058747879408bdb36241dc9c2e7c619faa12b2920967'
const taproot = 'bc1pfqarxerx6v0zh6zcj2f3a3np8jselxn8vgefdx95c0n328qpzg4ssw6kv5'
const unsupported = '3N722gUQ2YmphkTzm9nsgD8rkxh1xvukYC'
const header = page => page.getByRole('banner')
const connect = page => header(page).getByRole('button', { name: 'Conectar', exact: true }).first()
const account = page => header(page).getByText(/bc1q.*5ty/).filter({ visible: true }).first()

async function bridge(page, options = {}) {
  await page.exposeFunction('signCasaProof', message => {
    const signature = secp256k1.sign(legacyMessageHash(message), new Uint8Array(32).fill(9))
    return Buffer.from([31 + signature.recovery, ...signature.toCompactRawBytes()]).toString('base64')
  })
  await page.addInitScript(({ address, publicKey, taproot, unsupported, options }) => {
    const listeners = new Map()
    const state = {
      requests: 0, signatures: 0, psbts: 0, reject: false, unsupported: false,
      granted: sessionStorage.getItem('casa-grant') === 'yes',
      revoke() {
        state.granted = false
        sessionStorage.removeItem('casa-grant')
        for (const fn of listeners.get('accountsChanged') ?? []) fn([])
      },
      inject() {
        Object.assign(window, {
          ...(options.marker === false ? {} : { casaTookan: { isCasaTookan: true } }),
          unisat: {
            requestAccounts: async () => {
              state.requests++
              if (state.reject) throw { code: 4001, message: 'User rejected connection' }
              state.granted = true
              sessionStorage.setItem('casa-grant', 'yes')
              return [state.unsupported ? unsupported : options.taproot ? taproot : address]
            },
            getAccounts: async () => state.granted ? [state.unsupported ? unsupported : options.taproot ? taproot : address] : [],
            getPublicKey: async () => publicKey,
            getNetwork: async () => 'livenet',
            signMessage: async message => { state.signatures++; return window.signCasaProof(message) },
            signPsbt: async () => { state.psbts++; throw new Error('Unexpected transaction signing') },
            on: (event, fn) => {
              if (!listeners.has(event)) listeners.set(event, new Set())
              listeners.get(event).add(fn)
            },
            removeListener: (event, fn) => listeners.get(event)?.delete(fn),
          },
        })
      },
    }
    window.casaTest = state
    if (!options.delay) state.inject()
    if (options.competing) window.HorizonWalletProvider = { request: async () => { throw new Error('Wrong wallet selected') } }
  }, { address, publicKey, taproot, unsupported, options })
  for (const host of ['api.xcp.io', 'api.xcp.fun', 'mempool.space', 'api.digirare.com']) {
    await page.route('https://' + host + '/**', route => route.fulfill({ status: 503, json: { error: 'API disabled in wallet connection test' } }))
  }
}

async function disconnect(page) {
  if (await page.getByRole('button', { name: 'Desconectar', exact: true }).count() === 0) await account(page).click()
  await page.getByRole('button', { name: 'Desconectar', exact: true }).click()
}

test('pilot remains absent when disabled', async ({ page }) => {
  test.skip(enabled)
  await bridge(page)
  await page.goto(route)
  await connect(page).click()
  await expect(page.getByText('Casa Tookan', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => window.casaTest.requests)).toBe(0)
})

test.describe('enabled pilot', () => {
  test.skip(!enabled)

  test('connect verifies the proof, restores silently, and disconnects', async ({ page }) => {
    await bridge(page)
    await page.goto(route)
    await connect(page).click()
    await expect(account(page)).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.casaTest.signatures)).toBe(1)

    await page.reload()
    await expect(account(page)).toBeVisible()
    expect(await page.evaluate(() => window.casaTest.requests)).toBe(0)
    await disconnect(page)
    await expect(connect(page)).toBeVisible()
    await page.reload()
    await expect(connect(page)).toBeVisible()
    expect(await page.evaluate(() => window.casaTest.psbts)).toBe(0)
  })

  test('rejection and unsupported accounts show an error and permit retry', async ({ page }) => {
    await bridge(page)
    await page.goto(route)
    await page.evaluate(() => { window.casaTest.reject = true })
    await connect(page).click()
    await expect(header(page).getByRole('alert')).toBeVisible()
    await page.evaluate(() => { window.casaTest.reject = false; window.casaTest.unsupported = true })
    await connect(page).click()
    await expect(header(page).getByRole('alert')).toContainText('Legacy, Native SegWit or BIP-86 Taproot')
    await page.evaluate(() => { window.casaTest.unsupported = false })
    await connect(page).click()
    await expect(account(page)).toBeVisible()
    await expect(header(page).getByRole('alert')).toHaveCount(0)
  })

  test('Taproot connects with its declared proof dialect', async ({ page }) => {
    await bridge(page, { taproot: true })
    await page.goto(route)
    await connect(page).click()
    await expect(page.getByText(/bc1p.*kv5/).filter({ visible: true }).first()).toBeVisible()
  })

  test('revocation clears both live and restored connections', async ({ page }) => {
    await bridge(page)
    await page.goto(route)
    await connect(page).click()
    await expect(account(page)).toBeVisible()
    await page.evaluate(() => window.casaTest.revoke())
    await expect(connect(page)).toBeVisible()
    await connect(page).click()
    await expect(account(page)).toBeVisible()
    await page.evaluate(() => sessionStorage.removeItem('casa-grant'))
    await page.reload()
    await expect(connect(page)).toBeVisible()
    expect(await page.evaluate(() => window.casaTest.requests)).toBe(0)
  })

  test('chooser selects Casa when another wallet is installed', async ({ page }) => {
    await bridge(page, { competing: true })
    await page.goto(route)
    await connect(page).click()
    await page.getByRole('listitem').filter({ hasText: 'Casa Tookan' }).getByRole('button', { name: 'Conectar', exact: true }).click()
    await expect(account(page)).toBeVisible()
  })

  test('mobile connect discovers a late bridge without an install detour', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await bridge(page, { delay: true })
    await page.goto(route)
    await expect(connect(page)).toBeVisible()
    await page.evaluate(() => window.casaTest.inject())
    await connect(page).click()
    await expect(account(page)).toBeVisible()
    await expect(page.getByText('Solo en computadora, por ahora', { exact: true })).toHaveCount(0)
    expect(await header(page).evaluate(el => el.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('mobile-connected.png') })
    await disconnect(page)
    await expect(connect(page)).toBeVisible()
  })

  test('Unisat alone is not detected as Casa', async ({ page }) => {
    await bridge(page, { marker: false })
    await page.goto(route)
    await connect(page).click()
    expect(await page.evaluate(() => window.casaTest.requests)).toBe(0)
    await expect(page.getByRole('listitem').filter({ hasText: 'Casa Tookan' }).getByRole('button', { name: 'Conectar', exact: true })).toHaveCount(0)
  })
})

test('app metadata and missing paths preserve JSON/404 and CORS', async ({ request }) => {
  const manifest = await request.get('/.well-known/wallet-app.json')
  expect(manifest.status()).toBe(200)
  expect(manifest.headers()['access-control-allow-origin']).toBe('*')
  expect((await manifest.json()).wallet.version).toBe('1')
  const missing = await request.get('/.well-known/missing-casa-test.json')
  expect(missing.status()).toBe(404)
  expect(missing.headers()['access-control-allow-origin']).toBe('*')
})

for (const width of [1280, 390]) {
  test(`Taproot inscription is unavailable before upload or signing at ${width}px`, async ({ page }) => {
    test.skip(!enabled)
    await page.setViewportSize({ width, height: 900 })
    await bridge(page, { taproot: true })
    let uploads = 0
    await page.route('**/api/launches', route => {
      if (route.request().method() === 'POST') uploads++
      return route.fulfill({ status: 503, json: {} })
    })
    await page.goto('/es/create')
    await connect(page).click()
    await expect(page.getByText(/bc1p.*kv5/).filter({ visible: true }).first()).toBeVisible()
    await expect(page.getByRole('checkbox')).toBeDisabled()
    await expect(page.getByText('Usa una billetera compatible con inscripciones de imágenes o lanza con una imagen alojada.')).toBeVisible()
    await expect(page.locator('input[type=file]')).toBeAttached()
    expect(uploads).toBe(0)
    expect(await page.evaluate(() => window.casaTest.psbts)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const signed of [false, true]) {
  test(`keeps pending inscription and allows resume only for signed reveal (${signed})`, async ({ page }) => {
    test.skip(!enabled)
    await bridge(page, { taproot: true })
    const pending = {
      version: 1, address: taproot, asset: 'TESTLAUNCH', startBlock: 999999,
      revealScript: '51', tapInternalKey: '11'.repeat(32), commitTxid: '22'.repeat(32),
      commitVout: 0, commitAmount: 10000, commitRawTx: '00', recipient: taproot,
      feeRate: 1, createdAt: Date.now(), ...(signed ? { revealRawTx: '00' } : {}),
    }
    await page.addInitScript(record => localStorage.setItem('xcp.fun:pending-reveal:' + record.address, JSON.stringify(record)), pending)
    await page.goto('/es/create')
    await connect(page).click()
    const finish = page.getByRole('button', { name: /TESTLAUNCH/ })
    if (signed) await expect(finish).toBeEnabled()
    else {
      await expect(finish).toBeDisabled()
      await expect(page.getByText('Conecta una billetera compatible con la revelación de esta inscripción para finalizar el lanzamiento.')).toBeVisible()
    }
    expect(await page.evaluate(address => JSON.parse(localStorage.getItem('xcp.fun:pending-reveal:' + address)), taproot)).toEqual(pending)
    expect(await page.evaluate(() => window.casaTest.psbts)).toBe(0)
  })
}
