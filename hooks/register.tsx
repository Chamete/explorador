import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ExpActividad, ExpEntrada, ExpVista } from '../types'
import type { FilaArbol } from './arbol'

// Explorador: árbol de archivos del proyecto en un panel. Lo que Claude lee
// respira en azul y lo que escribe en naranja; debajo, vista previa de
// Markdown y código del archivo elegido.

const PANEL = 'explorador'
const RESPIRO_MS = 1800 // un ciclo completo de respiración
const LATIDO_MS = 120 // cada cuánto se redibuja mientras algo respira
const COLA_MS = 4000 // tiempo que sigue respirando tras terminar
const MAX_VISTA = 300_000 // bytes máximos para previsualizar
const MAX_CARPETAS = 400 // tope al expandir o escanear todo
const MAX_FILAS = 800
const ACENTO = '#41B2BE' // turquesa de los interruptores encendidos

const raiz = atom({ plugin: 'explorador', key: 'raiz' } as const, '')
const listados = atom({ plugin: 'explorador', key: 'listados' } as const, {} as Record<string, ExpEntrada[]>)
const abiertas = atom({ plugin: 'explorador', key: 'abiertas' } as const, [] as string[])
const actividad = atom({ plugin: 'explorador', key: 'actividad' } as const, {} as Record<string, ExpActividad>)
const fase = atom({ plugin: 'explorador', key: 'fase' } as const, 0)
const seleccion = atom({ plugin: 'explorador', key: 'seleccion' } as const, '')
const vista = atom({ plugin: 'explorador', key: 'vista' } as const, null as ExpVista | null)
const previa = atom({ plugin: 'explorador', key: 'previa' } as const, true)
const ocultos = atom({ plugin: 'explorador', key: 'ocultos' } as const, false)
const filtro = atom({ plugin: 'explorador', key: 'filtro' } as const, '')
const desplaz = atom({ plugin: 'explorador', key: 'desplaz' } as const, 0)

// Ruido que no se muestra salvo con «Ocultos: sí».
const RUIDO = new Set(['.DS_Store', '.git', 'node_modules', '__pycache__', '.venv', 'venv', '.cache', '.next', '.turbo', 'Icon\r'])
const esRuido = (nombre: string) => RUIDO.has(nombre) || nombre.endsWith('.nosync') || nombre.endsWith('.icloud')

const ES_MD = /\.(md|markdown|mdx)$/i

// Aspecto de explorador de VS Code: carpetas en azul y cada archivo con el icono
// (dos caracteres) y el color de su extensión.
type Icono = { glifo: string; color: string }
const ICONO_ARCHIVO: Icono = { glifo: '▫ ', color: '#90A4AE' }
const ICONOS: [RegExp, Icono][] = [
  [/^(claude|agents|readme|changelog|license)\.md$/i, { glifo: 'ⓘ ', color: '#42A5F5' }],
  [/\.(md|markdown|mdx)$/i, { glifo: 'M↓', color: '#42A5F5' }],
  [/\.(tsx|jsx)$/i, { glifo: '⚛ ', color: '#00BCD4' }],
  [/\.(ts|mts|cts)$/i, { glifo: 'TS', color: '#3178C6' }],
  [/\.(js|mjs|cjs)$/i, { glifo: 'JS', color: '#E6C229' }],
  [/^package(-lock)?\.json$/i, { glifo: '{}', color: '#8BC34A' }],
  [/^tsconfig.*\.json$/i, { glifo: '{}', color: '#3178C6' }],
  [/\.(json|jsonc)$/i, { glifo: '{}', color: '#F9A825' }],
  [/\.py$/i, { glifo: 'PY', color: '#4B8BBE' }],
  [/\.(sh|zsh|bash)$/i, { glifo: '$_', color: '#8BC34A' }],
  [/\.(css|scss|sass|less)$/i, { glifo: '# ', color: '#42A5F5' }],
  [/\.html?$/i, { glifo: '<>', color: '#E44D26' }],
  [/\.(ya?ml)$/i, { glifo: 'Y ', color: '#CB4B16' }],
  [/\.(toml|ini|conf|cfg|env)$/i, { glifo: '⚙ ', color: '#90A4AE' }],
  [/^\.(gitignore|gitattributes)$/i, { glifo: '⎇ ', color: '#F4511E' }],
  [/\.(txt|log)$/i, { glifo: '≡ ', color: '#90A4AE' }],
  [/\.(csv|tsv|xlsx?)$/i, { glifo: '▦ ', color: '#43A047' }],
  [/\.svg$/i, { glifo: '◇ ', color: '#FFB300' }],
  [/\.(png|jpe?g|gif|webp|heic|ico|bmp)$/i, { glifo: '▣ ', color: '#26A69A' }],
  [/\.(mp3|wav|m4a|aac|flac|ogg)$/i, { glifo: '♪ ', color: '#EF5350' }],
  [/\.(mp4|mov|webm|mkv|avi)$/i, { glifo: '▶ ', color: '#FF7043' }],
  [/\.pdf$/i, { glifo: '▤ ', color: '#E53935' }],
  [/\.(docx?|pages|rtf)$/i, { glifo: 'W ', color: '#1E88E5' }],
  [/\.(pptx?|key)$/i, { glifo: 'P ', color: '#F4511E' }],
  [/\.(zip|tar|gz|tgz|rar|7z)$/i, { glifo: '▥ ', color: '#AFB42B' }],
  [/\.(lock)$/i, { glifo: '⊡ ', color: '#90A4AE' }],
  [/\.(sql|db|sqlite)$/i, { glifo: '⛁ ', color: '#FF8F00' }],
]
const iconoDe = (nombre: string): Icono => ICONOS.find(([re]) => re.test(nombre))?.[1] ?? ICONO_ARCHIVO
const ES_CODIGO = /\.(tsx?|jsx?|mjs|cjs|mts|cts|json|jsonc|py|sh|zsh|bash|css|scss|html?|ya?ml|toml|ini|txt|csv|tsv|xml|svg|sql|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|m|php|lua|r|env|gitignore|conf|log)$/i

// Herramientas que leen o escriben un archivo, y el campo donde va la ruta.
const HERRAMIENTAS: Record<string, { campo: string; tipo: 'lee' | 'escribe' }> = {
  Read: { campo: 'file_path', tipo: 'lee' },
  Write: { campo: 'file_path', tipo: 'escribe' },
  Edit: { campo: 'file_path', tipo: 'escribe' },
  MultiEdit: { campo: 'file_path', tipo: 'escribe' },
  NotebookEdit: { campo: 'notebook_path', tipo: 'escribe' },
}

// Paletas de la respiración: del tono suave al intenso y vuelta.
const COLORES = {
  lee: { suave: [147, 197, 253], fuerte: [37, 99, 235] },
  escribe: { suave: [253, 186, 116], fuerte: [234, 88, 12] },
} as const

const unir = (dir: string, nombre: string) => (dir ? `${dir}/${nombre}` : nombre)
const padre = (ruta: string) => (ruta.includes('/') ? ruta.slice(0, ruta.lastIndexOf('/')) : '')
const nombreDe = (ruta: string) => ruta.slice(ruta.lastIndexOf('/') + 1)
const absoluta = (base: string, ruta: string) => (ruta ? `${base}/${ruta}` : base)
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const colorRespiro = (tipo: 'lee' | 'escribe', f: number) => {
  const t = (1 - Math.cos(2 * Math.PI * f)) / 2
  const { suave, fuerte } = COLORES[tipo]
  const c = suave.map((v, i) => Math.round(v + ((fuerte[i] ?? v) - v) * t))
  return `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

// ---------------------------------------------------------------------------
// Carpetas

const listar = async ($: EngineInterface, ruta: string): Promise<ExpEntrada[] | null> => {
  const base = await read($, raiz)
  const entradas = await $.fs.list(absoluta(base, ruta)).catch(() => null)
  if (!entradas) return null
  const lista: ExpEntrada[] = []
  for (const e of entradas) {
    let tipo: 'dir' | 'archivo' = e.kind === 'dir' ? 'dir' : 'archivo'
    if (e.isLink) {
      const destino = await $.fs.stat(absoluta(base, unir(ruta, e.name))).catch(() => null)
      tipo = destino?.kind === 'dir' ? 'dir' : 'archivo'
    }
    lista.push({ nombre: e.name, tipo, tam: e.size })
  }
  return lista.sort((a, b) => (a.tipo === b.tipo ? a.nombre.localeCompare(b.nombre, 'es', { numeric: true }) : a.tipo === 'dir' ? -1 : 1))
}

const cargar = async ($: EngineInterface, rutas: string[]) => {
  const nuevos: Record<string, ExpEntrada[] | null> = {}
  for (const r of rutas) nuevos[r] = await listar($, r)
  await update($, listados, actual => {
    const copia = { ...actual }
    for (const [r, l] of Object.entries(nuevos)) {
      if (l) copia[r] = l
      else delete copia[r]
    }
    return copia
  })
}

// Recorre el árbol desde la raíz (sin ruido, salvo que se muestre) hasta el tope.
const recorrerTodo = async ($: EngineInterface): Promise<string[]> => {
  const verOcultos = await read($, ocultos)
  const vistas: string[] = []
  const cola = ['']
  while (cola.length && vistas.length < MAX_CARPETAS) {
    const dir = cola.shift() as string
    vistas.push(dir)
    const lista = (await read($, listados))[dir] ?? (await listar($, dir))
    if (!lista) continue
    await update($, listados, actual => ({ ...actual, [dir]: lista }))
    for (const e of lista) if (e.tipo === 'dir' && (verOcultos || !esRuido(e.nombre))) cola.push(unir(dir, e.nombre))
  }
  return vistas
}

let refresco: Timer | undefined
const refrescarPronto = ($: EngineInterface) => {
  refresco?.cancel()
  refresco = $.clock.after(400, () => {
    void read($, listados).then(l => cargar($, Object.keys(l)))
  })
}

// ---------------------------------------------------------------------------
// Vista previa

const tipoDe = (ruta: string): ExpVista['tipo'] => (ES_MD.test(ruta) ? 'md' : ES_CODIGO.test(ruta) ? 'codigo' : 'otro')

const cargarVista = async ($: EngineInterface, ruta: string) => {
  if (!ruta || !(await read($, previa))) return
  const base = await read($, raiz)
  const tipo = tipoDe(ruta)
  const vacia: ExpVista = { ruta, tipo, texto: '', aviso: '' }
  if (tipo === 'otro') return update($, vista, () => ({ ...vacia, aviso: 'Sin vista previa para este tipo de archivo.' }))
  const info = await $.fs.stat(absoluta(base, ruta)).catch(() => null)
  if (!info) return update($, vista, () => ({ ...vacia, aviso: 'El archivo ya no existe.' }))
  if (info.size > MAX_VISTA) return update($, vista, () => ({ ...vacia, aviso: `Demasiado grande para previsualizar (${Math.round(info.size / 1024)} KB).` }))
  const texto = await $.fs.read(absoluta(base, ruta)).catch(() => null)
  if (texto === null || texto.includes('\u0000')) return update($, vista, () => ({ ...vacia, tipo: 'otro', aviso: 'No se puede leer como texto.' }))
  await update($, vista, () => ({ ...vacia, texto }))
}

// Los enlaces relativos a otros .md pasan a file:// para poder abrirlos en la vista previa.
const enlazarMd = (texto: string, ruta: string, base: string) => {
  const enlaces: string[] = []
  const salida = texto.replace(/\]\(([^)\s#]+\.(?:md|markdown|mdx))(#[^)]*)?\)/gi, (todo, destino: string) => {
    if (/^[a-z]+:/i.test(destino)) return todo
    const partes = [...padre(ruta).split('/').filter(Boolean)]
    for (const p of destino.split('/')) {
      if (p === '..') partes.pop()
      else if (p && p !== '.') partes.push(p)
    }
    const href = `file://${encodeURI(absoluta(base, partes.join('/')))}`
    enlaces.push(href)
    return `](${href})`
  })
  return { salida, enlaces }
}

const elegir = async ($: EngineInterface, ruta: string) => {
  await update($, seleccion, () => ruta)
  await cargarVista($, ruta)
}

// ---------------------------------------------------------------------------
// Respiración

let latido: Timer | undefined
const respirar = ($: EngineInterface) => {
  if (latido) return
  latido = $.clock.every(LATIDO_MS, () => {
    void (async () => {
      const ahora = await $.clock.now()
      const act = await read($, actividad)
      const vivas = Object.entries(act).filter(([, a]) => a.enCurso > 0 || a.hasta > ahora)
      if (vivas.length !== Object.keys(act).length) await update($, actividad, () => Object.fromEntries(vivas))
      if (vivas.length === 0) {
        latido?.cancel()
        latido = undefined
        return
      }
      await update($, fase, () => Math.round(((ahora % RESPIRO_MS) / RESPIRO_MS) * 100) / 100)
    })()
  })
}

const marcar = async ($: EngineInterface, ruta: string, tipo: 'lee' | 'escribe', paso: 1 | -1) => {
  const ahora = await $.clock.now()
  await update($, actividad, act => {
    const previa_ = act[ruta]
    const enCurso = Math.max(0, (previa_?.enCurso ?? 0) + paso)
    // Escribir manda sobre leer mientras las dos coinciden.
    const tipoFinal = previa_?.tipo === 'escribe' && previa_.enCurso > 0 ? 'escribe' : tipo
    return { ...act, [ruta]: { tipo: tipoFinal, enCurso, hasta: paso < 0 ? ahora + COLA_MS : previa_?.hasta ?? 0 } }
  })
  respirar($)
}

// ---------------------------------------------------------------------------
// Filas del árbol

type Fila = { ruta: string; nombre: string; nivel: number; tipo: 'dir' | 'archivo'; abierta: boolean }

const construirFilas = (
  lst: Record<string, ExpEntrada[]>,
  abiertasSet: Set<string>,
  verOcultos: boolean,
  textoFiltro: string,
): Fila[] => {
  const filas: Fila[] = []
  const f = sinTildes(textoFiltro.trim())

  if (!f) {
    const bajar = (dir: string, nivel: number) => {
      for (const e of lst[dir] ?? []) {
        if (!verOcultos && esRuido(e.nombre)) continue
        if (filas.length >= MAX_FILAS) return
        const ruta = unir(dir, e.nombre)
        const abierta = e.tipo === 'dir' && abiertasSet.has(ruta)
        filas.push({ ruta, nombre: e.nombre, nivel, tipo: e.tipo, abierta })
        if (abierta) bajar(ruta, nivel + 1)
      }
    }
    bajar('', 0)
    return filas
  }

  // Con filtro: los archivos que coinciden, con sus carpetas por encima, todo desplegado.
  const coinciden = new Set<string>()
  for (const [dir, lista] of Object.entries(lst)) {
    if (!verOcultos && dir.split('/').some(esRuido)) continue
    for (const e of lista) {
      if (!verOcultos && esRuido(e.nombre)) continue
      if (sinTildes(e.nombre).includes(f)) {
        let r = unir(dir, e.nombre)
        coinciden.add(r)
        while (r.includes('/')) coinciden.add((r = padre(r)))
      }
    }
  }
  const bajar = (dir: string, nivel: number) => {
    for (const e of lst[dir] ?? []) {
      const ruta = unir(dir, e.nombre)
      if (!coinciden.has(ruta) || filas.length >= MAX_FILAS) continue
      filas.push({ ruta, nombre: e.nombre, nivel, tipo: e.tipo, abierta: e.tipo === 'dir' })
      if (e.tipo === 'dir') bajar(ruta, nivel + 1)
    }
  }
  bajar('', 0)
  return filas
}

// Clic en una fila: una carpeta se pliega o despliega; un archivo se elige.
const pulsarFila = async ($: EngineInterface, ruta: string, esDir: boolean) => {
  if (esDir) {
    if (await read($, filtro)) return
    const abierta = (await read($, abiertas)).includes(ruta)
    await update($, abiertas, a => (abierta ? a.filter(r => r !== ruta) : [...a, ruta]))
    if (!abierta && !(ruta in (await read($, listados)))) await cargar($, [ruta])
  } else {
    await elegir($, ruta)
  }
}

// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // La raíz del proyecto, no la carpeta actual: un `cd` en la terminal no la mueve.
    const proyecto = await $.session.root().catch(() => e.cwd)
    if ((await read($, raiz)) !== proyecto) {
      // Otra raíz: lo listado antes pertenece a otra carpeta y se descarta.
      await update($, listados, () => ({}))
      await update($, abiertas, () => [])
      await update($, desplaz, () => 0)
      await update($, seleccion, () => '')
      await update($, vista, () => null)
    }
    await update($, raiz, () => proyecto)
    const guardado = (await $.store.get('preferencias')) as { previa?: boolean; ocultos?: boolean } | undefined
    if (guardado?.previa !== undefined) await update($, previa, () => guardado.previa as boolean)
    if (guardado?.ocultos !== undefined) await update($, ocultos, () => guardado.ocultos as boolean)
    await cargar($, ['', ...(await read($, abiertas))])
    await $.command.register({ name: 'explorador', description: 'Abre el árbol de archivos del proyecto con vista previa' })
    void $.ui.open({ id: PANEL, title: 'Explorador' })
    return r
  })

  on('command.run', { command: 'explorador' }, async $ => {
    await $.ui.open({ id: PANEL, title: 'Explorador' })
    return { text: 'Explorador abierto.' }
  })

  // Nunca bloquea una herramienta: si algo del mod falla, la llamada sigue igual.
  on('tool.call', async ($, e, next) => {
    const herramienta = HERRAMIENTAS[String(e.tool)]
    const base = await read($, raiz)
    const valor = herramienta ? (e as Record<string, unknown>)[herramienta.campo] : undefined
    const ruta = typeof valor === 'string' && base && valor.startsWith(`${base}/`) ? valor.slice(base.length + 1) : ''

    if (!herramienta || !ruta) {
      const res = await next(e)
      if (String(e.tool) === 'Bash') refrescarPronto($)
      return res
    }

    await marcar($, ruta, herramienta.tipo, 1)
    try {
      return await next(e)
    } finally {
      await marcar($, ruta, herramienta.tipo, -1)
      if (herramienta.tipo === 'escribe') {
        await cargar($, [padre(ruta)])
        if ((await read($, seleccion)) === ruta) await cargarVista($, ruta)
      }
    }
  }).catch(($, e, next) => next(e))

  // Clics que envía el árbol dibujado por el Client.
  on('ui.message', { element: 'arbol' }, async ($, e) => {
    const d = e.data as { tipo?: string; ruta?: string; dir?: boolean } | null
    if (d?.tipo === 'pulsar' && typeof d.ruta === 'string') await pulsarFila($, d.ruta, d.dir === true)
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const tabla = $.ui.resolve(e)
    const { Box, Text, Button, Markdown, Code } = tabla
    // El móvil no tiene campo de texto: allí no hay filtro.
    const Input = 'Input' in tabla ? tabla.Input : undefined
    // Escritorio y terminal: el árbol lo dibuja un Client propio (colores reales, puntero,
    // respiración local). Donde no hay Client (móvil, VS Code), filas de botones.
    const Client = 'Client' in tabla ? tabla.Client : undefined
    const base = await read($, raiz)
    const lst = await read($, listados)
    const abiertasSet = new Set(await read($, abiertas))
    const verOcultos = await read($, ocultos)
    const textoFiltro = await read($, filtro)
    const conPrevia = await read($, previa)
    const elegido = await read($, seleccion)
    const act = await read($, actividad)
    const hayActividad = Object.keys(act).length > 0
    const f = hayActividad && !Client ? await read($, fase) : 0
    const v = conPrevia ? await read($, vista) : null

    const filas = construirFilas(lst, abiertasSet, verOcultos, textoFiltro)

    // Una carpeta plegada respira si algo de dentro respira.
    const actividadDe = (fila: Fila): ExpActividad | undefined => {
      const propia = act[fila.ruta]
      if (propia || fila.tipo !== 'dir' || fila.abierta) return propia
      const dentro = Object.entries(act).filter(([r]) => r.startsWith(`${fila.ruta}/`))
      if (!dentro.length) return undefined
      return dentro.find(([, a]) => a.tipo === 'escribe')?.[1] ?? dentro[0]?.[1]
    }

    // Con la vista previa abierta, el árbol ocupa como mucho la mitad del alto.
    // Medidas del panel: todo se adapta al ancho y al alto que tenga en cada momento.
    const medidas = e.props as { bodyColumns?: number; scroll?: { bodyRows?: number } }
    const ancho = medidas.bodyColumns ?? e.viewport?.columns ?? 40
    const alto = medidas.scroll?.bodyRows ?? e.viewport?.rows ?? 40
    const estrecho = ancho < 36
    const enUnaFila = ancho >= 52 // buscador e iconos en la misma fila
    const sangria = estrecho ? ' ' : '  '
    const tope = v ? Math.max(6, Math.floor(alto * (alto < 30 ? 0.4 : 0.45))) : filas.length
    const inicio = v ? Math.min(await read($, desplaz), Math.max(0, filas.length - tope)) : 0
    const visibles = filas.slice(inicio, inicio + tope)

    const guardarPreferencias = async () =>
      $.store.set('preferencias', { previa: await read($, previa), ocultos: await read($, ocultos) })

    // Botón de icono: todos del mismo ancho (un glifo). Sin `label`, porque el escritorio
    // lo dibuja en lugar del glifo; la `key` lo identifica y el nombre queda para leer el código.
    // Un interruptor encendido lleva el glifo en color; apagado, atenuado.
    const icono = (clave: string, _nombre: string, glifo: string, onPress: () => unknown, activo?: boolean) => (
      <Button key={clave} onPress={() => void onPress()}>
        <Text color={activo ? ACENTO : undefined} dimColor={activo === false}>
          {glifo}
        </Text>
      </Button>
    )

    // Casa: vuelve al estado inicial del árbol (raíz del proyecto, todo plegado, sin filtro)
    // y lleva el panel arriba del todo. La vista previa abierta se mantiene.
    const irALaRaiz = async () => {
      await update($, filtro, () => '')
      await update($, abiertas, () => [])
      await update($, desplaz, () => 0)
      await cargar($, [''])
      await $.ui.scroll({ in: PANEL, to: 'start', block: 'start' }).catch(() => undefined)
    }

    const mdPreparado = v?.tipo === 'md' && v.texto ? enlazarMd(v.texto, v.ruta, base) : null

    return (
      <Box flexDirection="column" gap={0}>
        <Box flexDirection={enUnaFila ? 'row' : 'column'} gap="xs" alignItems={enUnaFila ? 'center' : 'stretch'}>
          <Box flexDirection="row" gap="xs" alignItems="center" flexGrow={1} flexShrink={1}>
            {icono('casa', 'Ir a la raíz del proyecto', '⌂', irALaRaiz)}
            <Box flexGrow={1} flexShrink={1} minWidth={12}>
            {Input && <Input
            key="filtro"
            placeholder="Buscar…"
            value={textoFiltro}
            submitLabel="⌕"
            onInput={async (valor: string) => {
              await update($, filtro, () => valor)
              if (valor.trim()) await recorrerTodo($)
            }}
            onSubmit={async (valor: string) => {
              await update($, filtro, () => valor)
              if (valor.trim()) await recorrerTodo($)
            }}
          />}
            </Box>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" gap="xs" flexShrink={0}>
            {icono('expandir', 'Expandir todo', '⊞', async () => {
              await update($, abiertas, () => [])
              const todas = await recorrerTodo($)
              await update($, abiertas, () => todas.filter(Boolean))
            })}
            {icono('colapsar', 'Colapsar todo', '⊟', () => update($, abiertas, () => []))}
            {icono('previa', conPrevia ? 'Ocultar vista previa' : 'Mostrar vista previa', '◧', async () => {
              const nuevo = !(await read($, previa))
              await update($, previa, () => nuevo)
              if (nuevo) await cargarVista($, await read($, seleccion))
              else await update($, vista, () => null)
              await guardarPreferencias()
            }, conPrevia)}
            {icono('ocultos', verOcultos ? 'Esconder archivos ocultos' : 'Mostrar archivos ocultos', '◌', async () => {
              await update($, ocultos, o => !o)
              await guardarPreferencias()
            }, verOcultos)}
            {icono('refrescar', 'Refrescar', '↻', async () => cargar($, Object.keys(await read($, listados))))}
          </Box>
        </Box>

        <Text dimColor wrap="truncate-start">{nombreDe(base) || base}</Text>
        {filas.length === 0 && <Text dimColor>{textoFiltro ? 'Ningún archivo coincide.' : 'Carpeta vacía.'}</Text>}
        {inicio > 0 && (
          <Button key="subir" plain label={`▲ ${inicio} más`} onPress={() => update($, desplaz, d => Math.max(0, d - tope))} />
        )}
        {Client ? (
          <Client
            key="arbol"
            module="./arbol.tsx"
            props={{
              sangria: sangria.length,
              etiquetas: ancho >= 44,
              escritorio: e.surface === 'desktop',
              filas: visibles.map((fila): FilaArbol => {
                const a = actividadDe(fila)
                const ico = fila.tipo === 'dir' ? null : iconoDe(fila.nombre)
                return {
                  ruta: fila.ruta,
                  nombre: fila.nombre,
                  nivel: fila.nivel,
                  dir: fila.tipo === 'dir',
                  abierta: fila.abierta,
                  glifo: ico?.glifo ?? '',
                  color: ico?.color ?? '',
                  actividad: a?.tipo ?? '',
                  elegida: fila.ruta === elegido,
                  atenuada: esRuido(fila.nombre),
                }
              }),
            }}
          />
        ) : visibles.map(fila => {
          const a = actividadDe(fila)
          const respiro = a ? colorRespiro(a.tipo, f) : undefined
          const esDir = fila.tipo === 'dir'
          const atenuado = !a && esRuido(fila.nombre)
          const ico = esDir ? null : iconoDe(fila.nombre)
          return (
            <Button key={`f:${fila.ruta}`} plain onPress={() => pulsarFila($, fila.ruta, fila.tipo === 'dir')}>
              <Text dimColor inverse={fila.ruta === elegido}>
                {sangria.repeat(fila.nivel)}
                {esDir ? (fila.abierta ? '⌄ ' : '› ') : '  '}
              </Text>
              {ico ? (
                <Text color={ico.color} dimColor={atenuado} weight="semibold" inverse={fila.ruta === elegido}>
                  {ico.glifo}{' '}
                </Text>
              ) : null}
              <Text
                color={respiro}
                dimColor={atenuado}
                inverse={fila.ruta === elegido}
                weight={a ? 'semibold' : undefined}
                wrap="truncate-end"
              >
                {fila.nombre}
                {a ? (ancho >= 44 ? (a.tipo === 'lee' ? '  ● leyendo' : '  ● escribiendo') : ' ●') : ''}
              </Text>
            </Button>
          )
        })}
        {inicio + tope < filas.length && (
          <Button key="bajar" plain label={`▼ ${filas.length - inicio - tope} más`} onPress={() => update($, desplaz, d => d + tope)} />
        )}

        {v && (
          <Box flexDirection="column" marginTop={1} borderStyle="single" borderDimColor paddingX={estrecho ? 0 : 1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Box flexShrink={1}>
                <Text weight="semibold" wrap="truncate-start">{estrecho ? nombreDe(v.ruta) : v.ruta}</Text>
              </Box>
              <Button key="cerrar-vista" plain label="✕" onPress={() => update($, vista, () => null)} />
            </Box>
            {v.aviso ? (
              <Text dimColor>{v.aviso}</Text>
            ) : mdPreparado ? (
              <Markdown
                key="vista-md"
                text={mdPreparado.salida}
                pressableLinks={mdPreparado.enlaces.slice(0, 256)}
                onLinkPress={link => {
                  const destino = decodeURI(link.href.replace(/^file:\/\//, ''))
                  if (destino.startsWith(`${base}/`)) void elegir($, destino.slice(base.length + 1))
                }}
              />
            ) : (
              <Code source={v.texto} path={v.ruta} startLine={estrecho ? undefined : 1} wrap={estrecho ? 'wrap' : 'truncate-end'} />
            )}
          </Box>
        )}
      </Box>
    )
  })
}
