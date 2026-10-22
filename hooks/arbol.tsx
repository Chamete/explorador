import type { ClientModule, ClientSurface, JsonValue } from 'claude-code'

// Módulo de superficie del árbol: corre en la app (escritorio o terminal), no en el mod.
// Dibuja cada fila con sus colores (los botones nativos los ignoran), resalta la fila
// bajo el puntero, anima la respiración con su propio reloj y avisa al mod de cada clic.

export type FilaArbol = {
  ruta: string
  nombre: string
  nivel: number
  dir: boolean
  abierta: boolean
  glifo: string
  color: string
  actividad: '' | 'lee' | 'escribe'
  elegida: boolean
  atenuada: boolean
}

export type PropsArbol = { filas: FilaArbol[]; sangria: number; etiquetas: boolean; escritorio: boolean }

type Estado = { fase: number; encima: number; ultimas: { filas: FilaArbol[] } }

// Fondos translúcidos: sirven igual con tema claro y oscuro (solo en escritorio;
// la terminal marca la selección en vídeo inverso y no resalta el puntero).
const FONDO_ELEGIDA = '#42A5F533'
const FONDO_ENCIMA = '#8080801F'
const COLORES = {
  lee: { suave: [147, 197, 253], fuerte: [37, 99, 235] },
  escribe: { suave: [253, 186, 116], fuerte: [234, 88, 12] },
} as const
const PASO = 100 / 1800 // un ciclo de respiración cada 1,8 s
// La fila que respira se ilumina: un velo de su color que sube y baja (solo escritorio).
const VELO = { lee: '3B82F6', escribe: 'F97316' } as const
const velo = (tipo: 'lee' | 'escribe', fase: number) => {
  const t = (1 - Math.cos(2 * Math.PI * fase)) / 2
  return `#${VELO[tipo]}${Math.round(0x14 + (0x50 - 0x14) * t).toString(16).padStart(2, '0')}`
}

const respiro = (tipo: 'lee' | 'escribe', fase: number) => {
  const t = (1 - Math.cos(2 * Math.PI * fase)) / 2
  const { suave, fuerte } = COLORES[tipo]
  return `#${suave.map((v, i) => Math.round(v + ((fuerte[i] ?? v) - v) * t).toString(16).padStart(2, '0')).join('')}`
}

// Ancho en celdas: los emoji y algunos símbolos ocupan dos.
const anchoDe = (s: string) => [...s].reduce((n, c) => n + ((c.codePointAt(0) ?? 0) > 0x1f000 ? 2 : 1), 0)
const recortar = (s: string, max: number) => {
  if (max <= 1) return ''
  if (anchoDe(s) <= max) return s
  let salida = ''
  for (const c of s) {
    if (anchoDe(salida + c) > max - 1) break
    salida += c
  }
  return `${salida}…`
}

const Arbol: ClientModule<PropsArbol & JsonValue, Estado> = (props, surface: ClientSurface<Estado>) => {
  const { Box, Text } = surface.elements
  const estado = surface.state ?? { fase: 0, encima: -1, ultimas: { filas: props.filas } }
  estado.ultimas.filas = props.filas

  if (!surface.state) {
    surface.setState(estado)
    // El reloj solo redibuja mientras alguna fila respira.
    surface.every(100, () => {
      const actual = surface.state
      if (!actual || !actual.ultimas.filas.some(f => f.actividad)) return
      surface.setState({ ...actual, fase: (actual.fase + PASO) % 1 })
    })
  }

  surface.onPointer(ev => {
    const actual = surface.state ?? estado
    const fila = actual.ultimas.filas[ev.y]
    if (ev.type === 'move' || ev.type === 'enter') {
      const encima = fila ? ev.y : -1
      if (encima !== actual.encima) surface.setState({ ...actual, encima })
    } else if (ev.type === 'leave') {
      if (actual.encima !== -1) surface.setState({ ...actual, encima: -1 })
    } else if (ev.type === 'down' && ev.button === 'left' && fila) {
      surface.post({ tipo: 'pulsar', ruta: fila.ruta, dir: fila.dir })
    }
  })

  const columnas = surface.columns || 60

  return (
    <Box flexDirection="column">
      {props.filas.map((f, i) => {
        const fondo = !props.escritorio
          ? undefined
          : f.actividad
            ? velo(f.actividad, estado.fase)
            : f.elegida
              ? FONDO_ELEGIDA
              : i === estado.encima
                ? FONDO_ENCIMA
                : undefined
        // Sangría y flecha en monoespaciada: así cada nivel mide lo mismo con cualquier fuente.
        const sangria = ' '.repeat(props.sangria * f.nivel)
        const flecha = f.dir ? (f.abierta ? '▾ ' : '▸ ') : '  '
        const icono = f.dir ? (f.abierta ? '📂' : '📁') : f.glifo
        const marca = f.actividad ? (props.etiquetas ? (f.actividad === 'lee' ? '  ● leyendo' : '  ● escribiendo') : ' ●') : ''
        const libre = columnas - anchoDe(`${sangria}${flecha}${icono} ${marca}`)
        // Azul y naranja quedan reservados a lo que Claude lee o escribe; el resto, color del tema.
        const color = f.actividad ? respiro(f.actividad, estado.fase) : undefined
        const inversa = !props.escritorio && f.elegida
        return (
          <Box flexDirection="row" backgroundColor={fondo}>
            <Text mono dimColor>
              {sangria + flecha}
            </Text>
            <Text color={f.dir ? undefined : f.color} dimColor={f.atenuada} weight="semibold">
              {`${icono} `}
            </Text>
            <Text color={color} dimColor={f.atenuada && !f.actividad} weight={f.actividad ? 'semibold' : undefined} inverse={inversa}>
              {recortar(f.nombre, libre) + marca}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default Arbol
