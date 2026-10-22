# Cómo funciona el Explorador

Guía interna del mod para quien quiera entenderlo o modificarlo.

## Piezas

| Archivo | Papel |
|---|---|
| `hooks/register.tsx` | El *hooks module*: se registra en los eventos de Claude Code, guarda el estado y dibuja el panel. |
| `hooks/arbol.tsx` | Módulo de superficie (`Client`) que corre en la app y dibuja el árbol. |
| `types/index.d.ts` | Contrato de los valores que el mod guarda en `$.state`. |
| `tests/explorador.test.tsx` | Pruebas con el kit `claude-code/testing`. |

## Eventos

| Evento | Qué hace el mod |
|---|---|
| `session.start` | Toma la raíz del proyecto (`$.session.root()`), recupera las preferencias de `$.store`, lee la carpeta raíz, registra `/explorador` y abre el panel. |
| `command.run` (`explorador`) | Vuelve a abrir el panel. |
| `tool.call` | Marca la ruta como leída o escrita mientras dura la herramienta y 4 s después. Tras una escritura relee la carpeta del archivo y la vista previa si es ese archivo. Tras `Bash`, refresca las carpetas abiertas. Lleva un `.catch` que deja pasar la llamada si algo falla. |
| `ui.render` (`Pane` `explorador`) | Dibuja la barra, el buscador, el árbol y la vista previa. |
| `ui.message` (`arbol`) | Recibe los clics del árbol y pliega, despliega o selecciona. |

## Estado (`$.state`, namespace `explorador`)

| Clave | Contenido |
|---|---|
| `raiz` | Ruta absoluta de la raíz del proyecto. Si cambia, se descarta lo listado. |
| `listados` | Entradas de cada carpeta ya leída, por ruta relativa. |
| `abiertas` | Carpetas desplegadas. |
| `actividad` | Por ruta: `lee` o `escribe`, operaciones en curso y hasta cuándo respira. |
| `fase` | Fase de la respiración para las superficies sin `Client`. |
| `seleccion` / `vista` | Archivo elegido y su contenido para la vista previa. |
| `previa` / `ocultos` | Interruptores de la barra (también en `$.store`, entre sesiones). |
| `filtro` | Texto del buscador. |
| `desplaz` | Primera fila visible del árbol cuando la vista previa está abierta. |

## Respiración

- Ciclo de 1,8 s con una curva coseno entre un tono suave y uno intenso:
  - azul: de `#93C5FD` a `#2563EB`;
  - naranja: de `#FDBA74` a `#EA580C`.
- En la app de escritorio la fila además lleva un velo translúcido del mismo color (`#3B82F6` / `#F97316`), con una opacidad que va del 8 % al 31 %.
- El `Client` anima con su propio reloj (`surface.every(100 ms)`) y solo redibuja mientras alguna fila respira.
- En las superficies sin `Client`, el mod actualiza `fase` cada 120 ms mientras hay actividad.

## Rendimiento

- Las carpetas solo se leen al desplegarlas, al expandir todo (tope de 400), al buscar o tras escribir.
- El árbol dibuja como mucho 800 filas.
- La vista previa lee archivos de hasta 300 KB.

## Ajustes rápidos

En `hooks/register.tsx`:

```ts
const COLA_MS = 4000      // cuánto sigue respirando tras terminar
const MAX_VISTA = 300_000 // bytes máximos para previsualizar
const MAX_CARPETAS = 400  // tope al expandir o buscar
```

En `hooks/arbol.tsx`:

```ts
const PASO = 100 / 1800   // velocidad de la respiración (ciclo de 1,8 s)
const VELO = { lee: '3B82F6', escribe: 'F97316' }
```

Los iconos por extensión están en la tabla `ICONOS` de `hooks/register.tsx`.
