/** Una entrada de una carpeta ya listada. */
export type ExpEntrada = { nombre: string; tipo: 'dir' | 'archivo'; tam: number }

/** Lo que Claude está haciendo con una ruta: leerla o escribirla. */
export type ExpActividad = {
  tipo: 'lee' | 'escribe'
  /** Operaciones aún en marcha sobre la ruta. */
  enCurso: number
  /** Hasta cuándo sigue respirando tras terminar (ms desde epoch). */
  hasta: number
}

/** El archivo que se previsualiza. */
export type ExpVista = {
  ruta: string
  tipo: 'md' | 'codigo' | 'otro'
  texto: string
  aviso: string
}

declare module 'claude-code' {
  interface PluginState {
    explorador: {
      raiz: string
      listados: Record<string, ExpEntrada[]>
      abiertas: string[]
      actividad: Record<string, ExpActividad>
      fase: number
      seleccion: string
      vista: ExpVista | null
      previa: boolean
      ocultos: boolean
      filtro: string
      desplaz: number
    }
  }
}
