import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANEL = {
  plugin: 'explorador',
  component: 'Pane',
  requestId: 'explorador',
  props: {
    title: 'Explorador',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const CARPETAS: Record<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }[]> = {
  '/p': [
    { name: 'docs', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    { name: 'node_modules', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    { name: 'LEEME.md', kind: 'file', size: 20, mtimeMs: 1, isLink: false },
  ],
  '/p/docs': [{ name: 'guia.md', kind: 'file', size: 30, mtimeMs: 1, isLink: false }],
}

// El mundo bajo el mod: almacén y reloj simulados, y una carpeta /p de ejemplo.
const preparar = (on: On, raiz = '/p') => {
  mock.store(on)
  mock.clock(on)
  on('command.register', () => ({ value: { command: 'explorador' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.scroll', () => ({ value: {} }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: raiz }))
  on('fs.list', (_, e) => ({ value: CARPETAS[String(e.path)] ?? [] }))
  on('tool.call', () => ({ result: {} }))
}

const ARBOL = { in: 'arbol' } as const

test('dibuja el árbol, oculta el ruido y marca lo que se lee', async ($, on) => {
  preparar(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    expect(await ui.find({ type: 'Text', text: /LEEME\.md/, ...ARBOL })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /docs/, ...ARBOL })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /node_modules/, ...ARBOL })).toBeUndefined()
    await ui.unmount()
  }

  await $.tool.call({ tool: 'Read', file_path: '/p/LEEME.md' })
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /LEEME\.md/, ...ARBOL }))?.text).toContain('leyendo')
  await ui.unmount()
})

test('la barra solo dibuja iconos, sin textos', async ($, on) => {
  preparar(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    for (const [clave, glifo] of [['casa', '⌂'], ['expandir', '⊞'], ['colapsar', '⊟'], ['previa', '◧'], ['ocultos', '◌'], ['refrescar', '↻']] as const) {
      expect((await ui.find({ type: 'Button', key: clave }))?.text).toBe(glifo)
    }
    await ui.unmount()
  }
})

test('se adapta al ancho: el buscador va arriba y los nombres se recortan', async ($, on) => {
  preparar(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })

  for (const bodyColumns of [24, 40, 80]) {
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...PANEL, surface, props: { ...PANEL.props, bodyColumns } })
      await ui.resize({ columns: bodyColumns, rows: 10, ...ARBOL })
      expect(await ui.find({ type: 'Input', key: 'filtro' })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'expandir' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /LEEME/, ...ARBOL })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('clic en una carpeta la abre (📂) y la casa vuelve a la raíz', async ($, on) => {
  preparar(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: /📁/, ...ARBOL })).toBeDefined()
  await ui.pointer({ type: 'down', x: 4, y: 0, button: 'left', ...ARBOL })
  expect(await ui.find({ type: 'Text', text: /guia\.md/, ...ARBOL })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /📂/, ...ARBOL })).toBeDefined()

  await ui.press({ key: 'casa' })
  expect(await ui.find({ type: 'Text', text: /guia\.md/, ...ARBOL })).toBeUndefined()
  await ui.unmount()
})

test('estilo VS Code: parte de la raíz del proyecto, nombres sin color e icono por extensión', async ($, on) => {
  preparar(on)
  // La sesión se movió a una subcarpeta, pero la raíz del proyecto sigue siendo /p.
  await $.session.start({ cwd: '/p/docs', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANEL, surface })
    expect((await ui.find({ type: 'Text', text: /^docs$/, ...ARBOL }))?.props.color).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /M↓/, ...ARBOL }))?.props.color).toBe('#42A5F5')
    await ui.unmount()
  }
})

test('lo que se lee respira: el color cambia con el reloj de la app', async ($, on) => {
  preparar(on)
  await $.session.start({ cwd: '/p', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Read', file_path: '/p/LEEME.md' })

  const ui = await $.ui.mount({ ...PANEL, surface: 'desktop' })
  const antes = (await ui.find({ type: 'Text', text: /LEEME\.md/, ...ARBOL }))?.props.color
  await ui.advance(500)
  const despues = (await ui.find({ type: 'Text', text: /LEEME\.md/, ...ARBOL }))?.props.color
  expect(antes).toMatch(/^#[0-9a-f]{6}$/)
  expect(despues).not.toBe(antes)
  await ui.unmount()
})
