/**
 * Prompt del modelo de lenguaje local.
 *
 * Un modelo pequeño (0.5B–1.5B) se equivoca armando un JSON grande, pero sí escribe
 * bien órdenes cortas de una línea. Por eso no genera el diagrama: traduce el pedido
 * a las órdenes canónicas que el intérprete ejecuta y valida.
 */

// Sin marcadores tipo "Nombre" o "ClaseA": un modelo pequeño los copia literalmente.
// Solo formatos con ejemplos concretos.
const SISTEMA = `Eres un asistente que diseña diagramas de clases UML.
Respondes SOLO con órdenes, una por línea, sin explicaciones ni markdown.
Cada clase del dominio es una orden "clase" distinta, con sus propios atributos.

Formatos de las órdenes (ejemplos):
clase Producto: nombre texto, precio decimal, stock entero
metodo Producto: calcularTotal(cantidad: entero): decimal
relacion Cliente 1 a muchos Pedido "realiza"
relacion Persona 1 a 1 Pasaporte
relacion Estudiante muchos a muchos Curso
herencia Gerente de Empleado
composicion Pedido de LineaPedido
agregacion Equipo de Jugador
elimina la clase Producto
elimina el atributo stock de Producto
renombra la clase Producto a Articulo

Tipos permitidos: texto, entero, decimal, real, booleano, fecha, fecha y hora, hora.
Clases en singular. No repitas atributos. No agregues id.`;

// Dos ejemplos cortos: asociaciones con cardinalidad, herencia y composición
const EJEMPLOS = [
  [
    'Pedido: una biblioteca donde los socios piden libros prestados',
    `clase Libro: titulo texto, isbn texto, disponible booleano
clase Socio: nombre texto, email texto
clase Prestamo: fechaPrestamo fecha, fechaDevolucion fecha
relacion Socio 1 a muchos Prestamo "solicita"
relacion Libro 1 a muchos Prestamo`,
  ],
  [
    'Pedido: una tienda online con clientes que hacen pedidos formados por líneas; algunos clientes son premium',
    `clase Cliente: nombre texto, email texto
clase ClientePremium: descuento decimal
clase Pedido: fecha fecha y hora, total decimal
clase LineaPedido: cantidad entero, precio decimal
herencia ClientePremium de Cliente
relacion Cliente 1 a muchos Pedido "realiza"
composicion Pedido de LineaPedido`,
  ],
];

const nombreAtributo = (a) => String(a).replace(/^[+\-#~]\s*/, '').split(/[:=]/)[0].trim();

/** Resumen compacto del diagrama actual para que el modelo use los nombres existentes. */
const describirDiagrama = (nodes = [], edges = []) => {
  const clases = nodes.filter((n) => n.data?.className).slice(0, 30);
  if (!clases.length) return 'El diagrama está vacío.';
  const porId = new Map(clases.map((n) => [n.id, n.data.className]));
  const lineas = clases.map((n) => `${n.data.className}(${(n.data.attributes || []).slice(0, 8).map(nombreAtributo).join(', ')})`);
  const relaciones = edges
    .filter((e) => porId.has(e.source) && porId.has(e.target))
    .slice(0, 30)
    .map((e) => `${porId.get(e.source)} - ${porId.get(e.target)}`);
  return `Clases actuales: ${lineas.join('; ')}.${relaciones.length ? ` Relaciones: ${relaciones.join('; ')}.` : ''}`;
};

/** Mensajes de chat para el pipeline text-generation. */
export const construirMensajes = (pedido, nodes = [], edges = []) => [
  { role: 'system', content: `${SISTEMA}\n\n${describirDiagrama(nodes, edges)}` },
  ...EJEMPLOS.flatMap(([pregunta, respuesta]) => [
    { role: 'user', content: pregunta },
    { role: 'assistant', content: respuesta },
  ]),
  { role: 'user', content: `Pedido: ${pedido}` },
];

/**
 * Mensajes para un modelo con vista (Ollama). Devuelve las mismas órdenes de una línea que el
 * modelo de texto, así el intérprete y la validación son los mismos para foto, voz y texto.
 *
 * `imagenBase64` va sin el prefijo "data:image/...;base64,", que es como lo espera Ollama.
 */
export const construirMensajesImagen = (imagenBase64, nodes = [], edges = [], pedido = '') => [
  {
    role: 'system',
    content: `${SISTEMA}

Vas a mirar la foto de un diagrama de clases UML y escribir sus órdenes.
Lee el nombre de cada caja y los atributos que tiene debajo.
Las líneas entre cajas son relaciones: el triángulo blanco es herencia, el rombo negro es
composición, el rombo blanco es agregación y una línea simple es asociación.
Los números de los extremos (1, 0..*, 1..*, *) son la cardinalidad.
Si un texto no se lee con seguridad, omítelo en lugar de inventarlo.

${describirDiagrama(nodes, edges)}`,
  },
  {
    role: 'user',
    content: pedido?.trim()
      ? `${pedido.trim()}\nEscribe las órdenes del diagrama de la imagen.`
      : 'Escribe las órdenes que reproducen el diagrama de la imagen.',
    images: [imagenBase64],
  },
];

const INICIO_ORDEN = /^(clase|metodo|método|atributo|relacion|relación|herencia|composicion|composición|agregacion|agregación|elimina|renombra|implementa|dependencia)\b/i;

/** Quita markdown, viñetas y texto suelto; deja solo las líneas que son órdenes. */
export const limpiarRespuesta = (texto) => String(texto || '')
  .replace(/```[a-z]*\n?/gi, '')
  .split('\n')
  .map((l) => l.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s+)/, '').replace(/[.;]$/, ''))
  .filter((l) => INICIO_ORDEN.test(l))
  .join('\n');
