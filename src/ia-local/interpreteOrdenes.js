/**
 * Intérprete de órdenes en español para el diagramador: funciona sin internet,
 * sin modelos y en cualquier PC.
 *
 * Entiende frases como "crea la clase Producto con nombre texto y precio decimal",
 * "un cliente realiza muchas ventas", "Estudiante hereda de Persona" o
 * "elimina el atributo stock de Producto", y también el formato canónico que
 * produce el modelo de lenguaje local ("clase Producto: nombre texto").
 *
 * interpretar() convierte el texto en operaciones y aplicarOperaciones() las
 * ejecuta sobre los nodos y aristas del editor.
 */
import { formatearAtributo, formatearMetodo, parseAtributo, parseMetodo } from '../utils/umlParser.js';
import { tamanoNodo } from '../utils/distribucionImportada.js';

// ─────────────────────────────── Texto ───────────────────────────────

const SIN_TILDE = {
  'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
  'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i', 'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o',
  'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u', 'ñ': 'n',
};

/**
 * Minúsculas y sin tildes, con la MISMA longitud que el original: los índices de
 * una coincidencia sirven para recuperar el nombre tal como lo escribió el usuario.
 */
export const normalizar = (texto) => String(texto).split('').map((c) => {
  const l = c.toLowerCase();
  return SIN_TILDE[l] ?? (l.length === 1 ? l : c);
}).join('');

const quitarTildes = (s) => String(s).normalize('NFD').replace(/\p{Diacritic}/gu, '');
const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'para']);

const palabras = (s) => quitarTildes(s).split(/[^A-Za-z0-9_]+/).filter(Boolean);

/** "detalle de venta" -> "DetalleVenta"; "RedAristas" se conserva. */
export const nombreClase = (texto) => {
  const p = palabras(texto);
  if (p.length === 1 && /[a-z][A-Z]/.test(p[0])) return p[0].charAt(0).toUpperCase() + p[0].slice(1);
  return p.filter((w) => !PALABRAS_VACIAS.has(w.toLowerCase()))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('') || 'Clase';
};

/** "fecha de nacimiento" -> "fechaNacimiento"; "fecha_nacimiento" se conserva. */
export const nombreMiembro = (texto) => {
  const limpio = quitarTildes(String(texto).trim());
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(limpio)) return limpio.charAt(0).toLowerCase() + limpio.slice(1);
  const p = palabras(limpio).filter((w) => !PALABRAS_VACIAS.has(w.toLowerCase()));
  return p.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join('') || 'atributo';
};

/** Singular aproximado en español: ventas -> venta, profesores -> profesor. */
export const singular = (s) => {
  const t = String(s);
  if (/[^aeiou]ces$/i.test(t)) return t.slice(0, -3) + 'z';
  if (/[rlndsjy]es$/i.test(t) && t.length > 4) return t.slice(0, -2);
  if (/s$/i.test(t) && t.length > 3) return t.slice(0, -1);
  return t;
};

const clave = (s) => singular(normalizar(quitarTildes(s)).replace(/[^a-z0-9]/g, ''));

/** Divide la frase (normalizada y original a la vez) en los separadores del regex. */
const dividir = (frase, separador) => {
  const piezas = [];
  const re = new RegExp(separador.source, 'g');
  let desde = 0;
  let m;
  while ((m = re.exec(frase.norm)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    piezas.push({ norm: frase.norm.slice(desde, m.index), orig: frase.orig.slice(desde, m.index) });
    desde = m.index + m[0].length;
  }
  piezas.push({ norm: frase.norm.slice(desde), orig: frase.orig.slice(desde) });
  return piezas.map((p) => recortar(p)).filter((p) => p.norm);
};

const recortar = (p) => {
  const inicio = p.norm.length - p.norm.trimStart().length;
  const fin = p.norm.trimEnd().length;
  return { norm: p.norm.slice(inicio, fin), orig: p.orig.slice(inicio, fin) };
};

/** Aplica un regex (con flag d) y devuelve los grupos normalizados y originales. */
const coincidir = (regex, frase) => {
  const m = regex.exec(frase.norm);
  if (!m) return null;
  const grupo = (i) => (m.indices?.[i]
    ? { norm: m[i], orig: frase.orig.slice(m.indices[i][0], m.indices[i][1]) }
    : null);
  return { m, grupo };
};

const R = (fuente) => new RegExp(fuente, 'd');

// ─────────────────────────────── Tipos ───────────────────────────────

const TIPOS = {
  texto: 'String', cadena: 'String', string: 'String', varchar: 'String', text: 'String',
  caracteres: 'String', letras: 'String', char: 'String', caracter: 'String',
  entero: 'Integer', int: 'Integer', integer: 'Integer', 'numero entero': 'Integer', numero: 'Integer',
  long: 'Long', 'entero largo': 'Long', bigint: 'Long',
  decimal: 'BigDecimal', dinero: 'BigDecimal', moneda: 'BigDecimal', bigdecimal: 'BigDecimal', numeric: 'BigDecimal',
  real: 'Double', flotante: 'Double', float: 'Double', double: 'Double', doble: 'Double',
  booleano: 'Boolean', boolean: 'Boolean', bool: 'Boolean', logico: 'Boolean', 'verdadero o falso': 'Boolean', 'si o no': 'Boolean',
  fecha: 'LocalDate', date: 'LocalDate', localdate: 'LocalDate',
  'fecha y hora': 'LocalDateTime', fechahora: 'LocalDateTime', timestamp: 'LocalDateTime', datetime: 'LocalDateTime', localdatetime: 'LocalDateTime',
  hora: 'LocalTime', time: 'LocalTime', localtime: 'LocalTime',
};

/** Tipo Java a partir de una palabra ("decimal", "fecha y hora"...) o null. */
export const tipoDesdeTexto = (texto) => {
  const t = normalizar(String(texto)).trim().replace(/^(?:de\s+tipo|del\s+tipo|tipo|como|:)\s*/, '').replace(/\s+/g, ' ');
  if (TIPOS[t]) return TIPOS[t];
  if (/^[A-Z][A-Za-z0-9<>]*$/.test(String(texto).trim())) return String(texto).trim();
  return null;
};

/** Tipo razonable según el nombre cuando el usuario no lo dice. */
export const inferirTipo = (nombre) => {
  const n = normalizar(quitarTildes(nombre)).replace(/[^a-z0-9]/g, '');
  if (n === 'id' || /id$/.test(n) && n.length > 2 && /[A-Z_]id$|_id$|Id$/.test(nombre)) return 'Long';
  if (/^(fechahora|fechayhora|timestamp)/.test(n)) return 'LocalDateTime';
  if (/^(fecha|nacimiento|vencimiento)/.test(n)) return 'LocalDate';
  if (/^hora/.test(n)) return 'LocalTime';
  if (/(precio|total|monto|importe|saldo|costo|coste|subtotal|salario|sueldo|pago|descuento|impuesto|tarifa)/.test(n)) return 'BigDecimal';
  if (/(latitud|longitud|peso|altura|distancia|promedio|porcentaje|calificacion)/.test(n)) return 'Double';
  if (/^(activo|activa|habilitado|disponible|pagado|es[a-z]|tiene[a-z]|vigente)/.test(n)) return 'Boolean';
  if (/(cantidad|stock|edad|numero|nro|anio|ano$|dias|piso|capacidad|puntos|nota|orden|cupo|asientos)/.test(n)) return 'Integer';
  return 'String';
};

const MULTIPALABRA = /\b(fecha\s+y\s+hora|numero\s+entero|entero\s+largo|verdadero\s+o\s+falso|si\s+o\s+no)\b/g;

/** "fecha de nacimiento fecha", "precio: decimal", "stock de tipo entero", "email". */
const parsearAtributo = (pieza) => {
  const orig = pieza.orig.trim();
  if (orig.includes(':')) {
    const [nombre, ...resto] = orig.split(':');
    const tipoTexto = resto.join(':').trim();
    return { nombre: nombreMiembro(nombre), tipo: tipoDesdeTexto(tipoTexto) || tipoTexto || inferirTipo(nombre) };
  }
  const conTipo = coincidir(R('^(.+?)\\s+(?:de\\s+tipo|del\\s+tipo|tipo|como)\\s+(.+)$'), pieza);
  if (conTipo) {
    const tipo = tipoDesdeTexto(conTipo.grupo(2).orig);
    if (tipo) return { nombre: nombreMiembro(conTipo.grupo(1).orig), tipo };
  }
  const p = pieza.norm.split(/\s+/);
  const po = orig.split(/\s+/);
  for (let k = Math.min(3, p.length - 1); k >= 1; k--) {
    const tipo = TIPOS[p.slice(-k).join(' ')];
    if (tipo) return { nombre: nombreMiembro(po.slice(0, -k).join(' ')), tipo };
  }
  return { nombre: nombreMiembro(orig), tipo: inferirTipo(orig) };
};

/** Lista de atributos: "nombre texto, precio decimal y fecha y hora de alta". */
const parsearAtributos = (pieza) => {
  // Proteger los tipos de varias palabras antes de separar por "y" (mismo largo:
  // cada espacio pasa a \u0001 y los índices siguen alineados con el original)
  const protegido = { norm: pieza.norm.replace(MULTIPALABRA, (m) => m.replace(/\s/g, '\u0001')), orig: pieza.orig };
  return dividir(protegido, /\s*,\s*|\s+y\s+|\s+e\s+/)
    .map((p) => ({ norm: p.norm.replace(/\u0001/g, ' '), orig: p.orig }))
    .map((p) => ({ norm: p.norm.replace(/^(?:el|la|los|las|un|una|su)\s+/, ''), orig: p.orig.replace(/^(?:el|la|los|las|un|una|su)\s+/i, '') }))
    .filter((p) => p.norm && !/^(?:atributos?|campos?|propiedades)$/.test(p.norm))
    .map(parsearAtributo);
};

/** "calcularTotal(): decimal", "prestar", "calcular total que devuelve decimal". */
const parsearMetodo = (pieza) => {
  const orig = pieza.orig.trim();
  if (orig.includes('(')) {
    const m = parseMetodo(orig);
    return { nombre: m.nombre, parametros: m.parametros || [], tipoRetorno: tipoDesdeTexto(m.tipoRetorno) || m.tipoRetorno || 'void' };
  }
  const devuelve = coincidir(R('^(.+?)\\s+(?:que\\s+)?(?:devuelve|retorna|regresa)\\s+(?:una?\\s+)?(.+)$'), pieza);
  if (devuelve) {
    return { nombre: nombreMiembro(devuelve.grupo(1).orig), parametros: [], tipoRetorno: tipoDesdeTexto(devuelve.grupo(2).orig) || 'void' };
  }
  return { nombre: nombreMiembro(orig), parametros: [], tipoRetorno: 'void' };
};

const parsearMetodos = (pieza) => {
  // Las comas dentro de los paréntesis separan parámetros, no métodos
  let nivel = 0;
  const protegido = pieza.norm.split('').map((c) => {
    if (c === '(') nivel++;
    if (c === ')') nivel--;
    return nivel > 0 && c === ',' ? '' : c;
  }).join('');
  return dividir({ norm: protegido, orig: pieza.orig }, /\s*,\s*|\s+y\s+/)
    .map((p) => ({ norm: p.norm.replace(/^(?:el|los)\s+/, ''), orig: p.orig.replace(/^(?:el|los)\s+/i, '') }))
    .filter((p) => p.norm)
    .map(parsearMetodo);
};

// ──────────────────────────── Cardinalidades ────────────────────────────

const CANTIDAD = '(uno\\s+o\\s+mas|una\\s+o\\s+mas|al\\s+menos\\s+una?|cero\\s+o\\s+mas|ninguno\\s+o\\s+uno|cero\\s+o\\s+uno|a\\s+lo\\s+sumo\\s+una?|muchos|muchas|varios|varias|multiples|un|una|uno|\\d+|\\*)';

const cantidadACard = (t) => {
  const s = normalizar(t || '').trim();
  if (/^(uno|una) o mas$|^al menos/.test(s)) return '1..*';
  if (/^cero o mas$/.test(s)) return '*';
  if (/^(ninguno|cero) o uno$|^a lo sumo/.test(s)) return '0..1';
  if (/^(muchos|muchas|varios|varias|multiples|\*|n)$/.test(s)) return '*';
  if (/^(un|una|uno|1)$/.test(s)) return '1';
  if (/^\d+$/.test(s)) return s;
  return null;
};

/** "uno a muchos", "1:*", "1..* a 1", "muchos a muchos" -> [origen, destino] */
export const parsearCardinalidad = (texto) => {
  const s = normalizar(texto || '').trim();
  const palabrasCard = '(uno|una|1|muchos|muchas|varios|\\*|n)';
  const w = new RegExp(`^(?:de\\s+|como\\s+)?${palabrasCard}\\s+a\\s+${palabrasCard}$`).exec(s);
  const aCard = (x) => (/^(uno|una|1)$/.test(x) ? '1' : '*');
  if (w) return [aCard(w[1]), aCard(w[2])];
  const n = /^(?:de\s+|como\s+)?([0-9n*]+(?:\.\.[0-9n*]+)?)\s*(?::|-|a)\s*([0-9n*]+(?:\.\.[0-9n*]+)?)$/.exec(s);
  if (n) return [n[1].replace(/n/g, '*'), n[2].replace(/n/g, '*')];
  return null;
};

const TIPO_RELACION = {
  asociacion: 'Association', relacion: 'Association', composicion: 'Composition', agregacion: 'Aggregation',
  herencia: 'Generalization', generalizacion: 'Generalization', dependencia: 'Dependency',
  implementacion: 'Implementation', implementa: 'Implementation', realizacion: 'Implementation',
};

// ─────────────────────────────── Patrones ───────────────────────────────

const N = '([a-z_][a-z0-9_]*)';
const ART = '(?:(?:el|la|los|las|un|una|unos|unas|cada)\\s+)?';
const V_CREAR = '(?:crea|crear|creame|cree|genera|generar|define|definir|haz|hacer|agrega|agregar|agregame|anade|anadir|anademe|incluye|incluir|pon|poner|quiero|necesito|dibuja|dibujar|nueva|nuevo)';
const V_AGREGAR = '(?:agrega|agregar|agregale|anade|anadir|anadele|incluye|incluir|pon|ponle|poner|crea|crear)';
const V_ELIMINAR = '(?:elimina|eliminar|borra|borrar|quita|quitar|remueve|remover|suprime|suprimir|saca|sacar)';
const V_RENOMBRAR = '(?:renombra|renombrar|cambia\\s+el\\s+nombre\\s+(?:de|del)|cambiar\\s+el\\s+nombre\\s+(?:de|del))';
const V_CAMBIAR = '(?:cambia|cambiar|modifica|modificar|actualiza|actualizar|pon|poner|establece|establecer|convierte|convertir)';
const V_RELACIONAR = '(?:relaciona|relacionar|conecta|conectar|une|unir|asocia|asociar|vincula|vincular)';
const TIPOS_REL = '(relacion|asociacion|composicion|agregacion|herencia|generalizacion|dependencia|implementacion)';

const ref = (g, plural = false) => ({ nombre: g.orig, plural });

/** Separa "Producto con nombre texto y métodos calcular()" en clase, atributos y métodos. */
const partesDeClase = (pieza) => {
  const metodos = coincidir(R('^(.*?)(?:,\\s*|\\s+)?(?:y\\s+)?(?:con\\s+)?(?:los\\s+|el\\s+)?metodos?\\s*:?\\s*(.+)$'), pieza);
  const atributosPieza = metodos ? metodos.grupo(1) : pieza;
  const limpio = (p) => {
    const m = coincidir(R('^(?:con\\s+)?(?:los\\s+|sus\\s+)?(?:atributos?|campos?|propiedades)\\s*:?\\s*(.*)$'), p);
    return m ? m.grupo(1) : p;
  };
  return {
    atributos: atributosPieza && atributosPieza.norm.trim() ? parsearAtributos(limpio(recortar(atributosPieza))) : [],
    metodos: metodos ? parsearMetodos(recortar(metodos.grupo(2))) : [],
  };
};

const PLANTILLAS = [
  {
    claves: /tienda|minimarket|supermercado|almacen|comercio|ventas/,
    ordenes: [
      'clase Producto: nombre texto, precio decimal, stock entero',
      'clase Cliente: nombre texto, email texto, telefono texto',
      'clase Venta: fecha fecha y hora, total decimal',
      'clase DetalleVenta: cantidad entero, subtotal decimal',
      'clase Categoria: nombre texto',
      'relacion Cliente 1 a muchos Venta "realiza"',
      'composicion Venta de DetalleVenta',
      'relacion Producto 1 a muchos DetalleVenta',
      'relacion Categoria 1 a muchos Producto "agrupa"',
    ],
  },
  {
    claves: /biblioteca|libros|prestamos/,
    ordenes: [
      'clase Libro: titulo texto, isbn texto, anioPublicacion entero, disponible booleano',
      'clase Autor: nombre texto, nacionalidad texto',
      'clase Socio: nombre texto, email texto, telefono texto',
      'clase Prestamo: fechaPrestamo fecha, fechaDevolucion fecha, devuelto booleano',
      'relacion Autor 1 a muchos Libro "escribe"',
      'relacion Socio 1 a muchos Prestamo "solicita"',
      'relacion Libro 1 a muchos Prestamo',
    ],
  },
  {
    claves: /escuela|colegio|universidad|academia|escolar|estudiantes|alumnos/,
    ordenes: [
      'clase Estudiante: nombre texto, fechaNacimiento fecha, email texto',
      'clase Profesor: nombre texto, especialidad texto',
      'clase Curso: nombre texto, creditos entero, cupo entero',
      'clase Inscripcion: fecha fecha, nota decimal',
      'relacion Profesor 1 a muchos Curso "dicta"',
      'relacion Estudiante 1 a muchos Inscripcion',
      'relacion Curso 1 a muchos Inscripcion',
    ],
  },
  {
    claves: /hospital|clinica|consultorio|medico|pacientes/,
    ordenes: [
      'clase Paciente: nombre texto, fechaNacimiento fecha, telefono texto',
      'clase Medico: nombre texto, especialidad texto',
      'clase Cita: fecha fecha, hora hora, motivo texto',
      'clase HistoriaClinica: diagnostico texto, fechaRegistro fecha',
      'relacion Paciente 1 a muchos Cita "agenda"',
      'relacion Medico 1 a muchos Cita "atiende"',
      'composicion Paciente de HistoriaClinica',
    ],
  },
  {
    claves: /restaurante|comida|pedidos|delivery/,
    ordenes: [
      'clase Plato: nombre texto, precio decimal, disponible booleano',
      'clase Mesa: numero entero, capacidad entero',
      'clase Pedido: fecha fecha y hora, total decimal, estado texto',
      'clase DetallePedido: cantidad entero, subtotal decimal',
      'relacion Mesa 1 a muchos Pedido',
      'composicion Pedido de DetallePedido',
      'relacion Plato 1 a muchos DetallePedido',
    ],
  },
];

/**
 * Cada patrón recibe la frase ({norm, orig}) y devuelve operaciones o null.
 * El orden importa: los más específicos van primero.
 */
const PATRONES = [
  // ── Formato canónico (lo produce el modelo local) ──
  (f) => {
    const c = coincidir(R(`^clase\\s+${N}\\s*(?::\\s*(.*))?$`), f);
    if (!c) return null;
    const partes = c.grupo(2) ? partesDeClase(c.grupo(2)) : { atributos: [], metodos: [] };
    return [{ op: 'clase', clase: ref(c.grupo(1)), ...partes }];
  },
  (f) => {
    const c = coincidir(R(`^atributos?\\s+${N}\\s*:\\s*(.+)$`), f);
    return c ? [{ op: 'atributos', clase: ref(c.grupo(1)), atributos: parsearAtributos(c.grupo(2)) }] : null;
  },
  (f) => {
    const c = coincidir(R(`^metodos?\\s+${N}\\s*:\\s*(.+)$`), f);
    return c ? [{ op: 'metodos', clase: ref(c.grupo(1)), metodos: parsearMetodos(c.grupo(2)) }] : null;
  },
  (f) => {
    const c = coincidir(R(`^relacion\\s+${N}\\s+(.+?)\\s+${N}(?:\\s+"([^"]*)")?$`), f);
    if (!c) return null;
    const card = parsearCardinalidad(c.grupo(2).norm);
    if (!card) return null;
    return [{ op: 'relacion', tipo: 'Association', origen: ref(c.grupo(1)), destino: ref(c.grupo(3)), cardOrigen: card[0], cardDestino: card[1], etiqueta: c.grupo(4)?.orig || '' }];
  },
  (f) => {
    const c = coincidir(R(`^(composicion|agregacion)\\s+${N}\\s+(?:de|contiene|tiene)\\s+${N}$`), f);
    if (!c) return null;
    // El editor dibuja el rombo en el destino: el destino es el "todo"
    return [{ op: 'relacion', tipo: TIPO_RELACION[c.m[1]], origen: ref(c.grupo(3)), destino: ref(c.grupo(2)), cardOrigen: '*', cardDestino: '1' }];
  },
  (f) => {
    const c = coincidir(R(`^(?:herencia|generalizacion)\\s+${N}\\s+(?:de|hereda\\s+de|->)\\s+${N}$`), f);
    return c ? [{ op: 'relacion', tipo: 'Generalization', origen: ref(c.grupo(1)), destino: ref(c.grupo(2)) }] : null;
  },

  // ── Clases ──
  (f) => {
    const c = coincidir(R(`^(?:por\\s+favor\\s+)?${V_CREAR}\\s+(?:(?:una|la|las|unas|los)\\s+)?(?:nuevas?\\s+)?clases?\\s+(?:llamadas?\\s+|de\\s+nombre\\s+)?(.+)$`), f);
    if (!c) return null;
    const [nombres, ...resto] = dividir(c.grupo(1), /\s+con\s+/);
    const clases = dividir(nombres, /\s*,\s*|\s+y\s+|\s+e\s+/);
    const partes = resto.length ? partesDeClase({ norm: c.grupo(1).norm.slice(nombres.norm.length).replace(/^\s*con\s+/, ''), orig: c.grupo(1).orig.slice(nombres.orig.length).replace(/^\s*con\s+/i, '') }) : { atributos: [], metodos: [] };
    if (clases.length === 1) return [{ op: 'clase', clase: ref(clases[0]), ...partes }];
    return clases.map((cl) => ({ op: 'clase', clase: ref(cl), atributos: [], metodos: [] }));
  },
  (f) => {
    const c = coincidir(R(`^${V_CREAR}\\s+(?:un\\s+)?(?:nuevo\\s+)?(?:diagrama|modelo|sistema)\\s+(?:de\\s+clases\\s+)?(?:(?:de|para)\\s+(?:una?\\s+|el\\s+|la\\s+)?.+?\\s+)?con\\s+(?:las\\s+)?(?:clases\\s+)?(.+)$`), f);
    if (!c) return null;
    return dividir(c.grupo(1), /\s*,\s*|\s+y\s+|\s+e\s+/).map((cl) => ({ op: 'clase', clase: ref(cl), atributos: [], metodos: [] }));
  },
  (f) => {
    const c = coincidir(R(`^(?:${V_CREAR}\\s+)?(?:un\\s+)?(?:nuevo\\s+)?(?:diagrama|modelo|sistema)\\s+(?:de\\s+clases\\s+)?(?:de|para)\\s+(?:una?\\s+|el\\s+|la\\s+)?(.+)$`), f);
    if (!c) return null;
    const plantilla = PLANTILLAS.find((p) => p.claves.test(c.m[1]));
    if (!plantilla) return null;
    return [{ op: 'plantilla', tema: c.grupo(1).orig }, ...plantilla.ordenes.flatMap((o) => interpretarFrase({ norm: normalizar(o), orig: o }) || [])];
  },
  (f) => {
    const c = coincidir(R(`^(?:la\\s+)?clase\\s+${N}\\s+(?:tiene|con|lleva|contiene)\\s+(.+)$`), f);
    if (!c) return null;
    return [{ op: 'atributos', clase: ref(c.grupo(1)), ...partesDeClase(c.grupo(2)) }];
  },
  (f) => {
    const c = coincidir(R(`^${ART}${N}\\s+(?:tiene|lleva)\\s+(?:los\\s+|sus\\s+)?(?:atributos?|campos?|propiedades)\\s*:?\\s*(.+)$`), f);
    return c ? [{ op: 'atributos', clase: ref(c.grupo(1)), atributos: parsearAtributos(c.grupo(2)), metodos: [] }] : null;
  },

  // ── Atributos y métodos ──
  (f) => {
    const c = coincidir(R(`^${V_AGREGAR}\\s+(?:(?:el|los|un|unos)\\s+)?(?:nuevos?\\s+)?(atributos?|campos?|propiedad(?:es)?|metodos?)\\s+(.+?)\\s+(?:a|en|al|para)\\s+(?:la\\s+)?(?:clase\\s+)?${N}$`), f);
    if (!c) return null;
    return /^metodo/.test(c.m[1])
      ? [{ op: 'metodos', clase: ref(c.grupo(3)), metodos: parsearMetodos(c.grupo(2)) }]
      : [{ op: 'atributos', clase: ref(c.grupo(3)), atributos: parsearAtributos(c.grupo(2)), metodos: [] }];
  },
  (f) => {
    const c = coincidir(R(`^${V_AGREGAR}\\s+(?:a|en)\\s+(?:la\\s+)?(?:clase\\s+)?${N}\\s+(?:(?:el|los|un|unos)\\s+)?(atributos?|campos?|metodos?)\\s+(.+)$`), f);
    if (!c) return null;
    return /^metodo/.test(c.m[2])
      ? [{ op: 'metodos', clase: ref(c.grupo(1)), metodos: parsearMetodos(c.grupo(3)) }]
      : [{ op: 'atributos', clase: ref(c.grupo(1)), atributos: parsearAtributos(c.grupo(3)), metodos: [] }];
  },
  (f) => {
    const c = coincidir(R(`^${V_ELIMINAR}\\s+(?:el\\s+|los\\s+)?(atributos?|campos?|metodos?)\\s+${N}(?:\\(\\))?\\s+(?:de|del|en)\\s+(?:la\\s+)?(?:clase\\s+)?${N}$`), f);
    if (!c) return null;
    return [{ op: /^metodo/.test(c.m[1]) ? 'eliminarMetodo' : 'eliminarAtributo', clase: ref(c.grupo(3)), miembro: c.grupo(2).orig }];
  },
  (f) => {
    const c = coincidir(R(`^${V_RENOMBRAR}\\s+(?:el\\s+)?(?:atributo|campo)\\s+${N}\\s+(?:de|del|en)\\s+(?:la\\s+)?(?:clase\\s+)?${N}\\s+(?:a|por|como)\\s+${N}$`), f);
    return c ? [{ op: 'renombrarAtributo', clase: ref(c.grupo(2)), miembro: c.grupo(1).orig, nuevo: c.grupo(3).orig }] : null;
  },
  (f) => {
    const c = coincidir(R(`^${V_CAMBIAR}\\s+(?:el\\s+)?tipo\\s+(?:de|del)\\s+(?:atributo\\s+|campo\\s+)?${N}\\s+(?:de|del|en)\\s+(?:la\\s+)?(?:clase\\s+)?${N}\\s+(?:a|por|como)\\s+(.+)$`), f);
    if (!c) return null;
    const tipo = tipoDesdeTexto(c.grupo(3).orig);
    return tipo ? [{ op: 'tipoAtributo', clase: ref(c.grupo(2)), miembro: c.grupo(1).orig, tipo }] : null;
  },

  // ── Eliminar y renombrar clases ──
  (f) => {
    const c = coincidir(R(`^${V_ELIMINAR}\\s+(?:la\\s+)?${TIPOS_REL}\\s+(?:entre|de)\\s+${N}\\s+(?:y|e|a|con)\\s+${N}$`), f);
    return c ? [{ op: 'eliminarRelacion', a: ref(c.grupo(2)), b: ref(c.grupo(3)) }] : null;
  },
  (f) => {
    const c = coincidir(R(`^${V_ELIMINAR}\\s+(?:(?:la|las)\\s+)?clases?\\s+(.+)$`), f);
    return c ? dividir(c.grupo(1), /\s*,\s*|\s+y\s+|\s+e\s+/).map((cl) => ({ op: 'eliminarClase', clase: ref(cl) })) : null;
  },
  (f) => {
    const c = coincidir(R(`^${V_RENOMBRAR}\\s+(?:la\\s+)?(?:clase\\s+)?${N}\\s+(?:a|por|como)\\s+${N}$`), f);
    return c ? [{ op: 'renombrarClase', clase: ref(c.grupo(1)), nuevo: c.grupo(2).orig }] : null;
  },

  // ── Relaciones ──
  (f) => {
    const c = coincidir(R(`^${V_CAMBIAR}\\s+(?:la\\s+)?(?:cardinalidad|multiplicidad)\\s+(?:de\\s+la\\s+relacion\\s+)?(?:de|entre)\\s+${N}\\s+(?:y|a|con|e)\\s+${N}\\s+(?:a|por|como|en)\\s+(.+)$`), f);
    if (!c) return null;
    const card = parsearCardinalidad(c.grupo(3).norm);
    return card ? [{ op: 'cardinalidad', a: ref(c.grupo(1)), b: ref(c.grupo(2)), cardA: card[0], cardB: card[1] }] : null;
  },
  (f) => {
    const c = coincidir(R(`^${V_CAMBIAR}\\s+(?:la\\s+)?(?:relacion|asociacion)\\s+(?:de|entre)\\s+${N}\\s+(?:y|a|con|e)\\s+${N}\\s+(?:a|por|en|como)\\s+(?:una?\\s+)?${TIPOS_REL}$`), f);
    return c ? [{ op: 'tipoRelacion', a: ref(c.grupo(1)), b: ref(c.grupo(2)), tipo: TIPO_RELACION[c.m[3]] }] : null;
  },
  (f) => {
    const c = coincidir(R(`^(?:${V_CREAR}\\s+)?(?:una?\\s+)?${TIPOS_REL}\\s+(?:de\\s+tipo\\s+\\w+\\s+)?(?:entre|de|desde)\\s+${N}\\s+(?:y|e|a|con|hacia|hasta)\\s+${N}(?:\\s+(?:con\\s+(?:cardinalidad|multiplicidad)\\s+|de\\s+|como\\s+)?(.+))?$`), f);
    if (!c) return null;
    const tipo = TIPO_RELACION[c.m[1]];
    const [a, b] = [ref(c.grupo(2)), ref(c.grupo(3))];
    const card = c.grupo(4) ? parsearCardinalidad(c.grupo(4).norm) : null;
    if (tipo === 'Composition' || tipo === 'Aggregation') {
      // "composición entre Pedido y Linea": Pedido es el todo
      return [{ op: 'relacion', tipo, origen: b, destino: a, cardOrigen: card ? card[1] : '*', cardDestino: card ? card[0] : '1' }];
    }
    if (tipo === 'Generalization' || tipo === 'Implementation' || tipo === 'Dependency') {
      return [{ op: 'relacion', tipo, origen: a, destino: b }];
    }
    return [{ op: 'relacion', tipo, origen: a, destino: b, cardOrigen: card ? card[0] : '1', cardDestino: card ? card[1] : '*' }];
  },
  (f) => {
    const c = coincidir(R(`^${V_RELACIONAR}\\s+(?:la\\s+clase\\s+)?${N}\\s+(?:con|y|a)\\s+(?:la\\s+clase\\s+)?${N}(?:\\s+(.+))?$`), f);
    if (!c) return null;
    const card = c.grupo(3) ? parsearCardinalidad(c.grupo(3).norm.replace(/^(?:de|como|en|con)\s+/, '').replace(/^(?:cardinalidad|multiplicidad)\s+/, '')) : null;
    return [{ op: 'relacion', tipo: 'Association', origen: ref(c.grupo(1)), destino: ref(c.grupo(2)), cardOrigen: card ? card[0] : '1', cardDestino: card ? card[1] : '*' }];
  },
  (f) => {
    const c = coincidir(R(`^${ART}${N}\\s+(?:hereda\\s+de|extiende\\s+(?:a\\s+|de\\s+)?|es\\s+(?:una?\\s+)?(?:subclase|clase\\s+hija|hija|tipo|especializacion)\\s+de|deriva\\s+de)\\s+(?:la\\s+clase\\s+)?(?:una?\\s+|el\\s+|la\\s+)?${N}$`), f);
    return c ? [{ op: 'relacion', tipo: 'Generalization', origen: ref(c.grupo(1)), destino: ref(c.grupo(2)) }] : null;
  },
  (f) => {
    const c = coincidir(R(`^${ART}${N}\\s+implementa\\s+(?:la\\s+)?(?:interfaz\\s+)?${N}$`), f);
    return c ? [{ op: 'relacion', tipo: 'Implementation', origen: ref(c.grupo(1)), destino: ref(c.grupo(2)) }] : null;
  },
  (f) => {
    const c = coincidir(R(`^${ART}${N}\\s+(?:se\\s+compone\\s+de|esta\\s+compuest[oa]\\s+(?:de|por)|esta\\s+formad[oa]\\s+por|contiene)\\s+(?:${CANTIDAD}\\s+)?${N}$`), f);
    if (!c) return null;
    const cantidad = c.grupo(2)?.norm;
    return [{ op: 'relacion', tipo: 'Composition', origen: ref(c.grupo(3), true), destino: ref(c.grupo(1)), cardOrigen: cantidadACard(cantidad) || '*', cardDestino: '1' }];
  },
  (f) => {
    const c = coincidir(R(`^${ART}${N}\\s+es\\s+parte\\s+de\\s+(?:una?\\s+|el\\s+|la\\s+)?${N}$`), f);
    return c ? [{ op: 'relacion', tipo: 'Composition', origen: ref(c.grupo(1)), destino: ref(c.grupo(2)), cardOrigen: '*', cardDestino: '1' }] : null;
  },
  (f) => {
    const c = coincidir(R(`^${ART}${N}\\s+(?:depende\\s+de|usa|utiliza)\\s+(?:una?\\s+|el\\s+|la\\s+)?${N}$`), f);
    return c ? [{ op: 'relacion', tipo: 'Dependency', origen: ref(c.grupo(1)), destino: ref(c.grupo(2)) }] : null;
  },
  (f) => {
    // "un cliente realiza muchas ventas", "producto pertenece a una categoria"
    const c = coincidir(R(`^${ART}${N}\\s+(?:puede\\s+)?([a-z]+)\\s+(?:a\\s+|con\\s+)?${CANTIDAD}\\s+${N}$`), f);
    if (!c) return null;
    const verbo = c.m[2];
    const card = cantidadACard(c.grupo(3).norm);
    if (!card) return null;
    const plural = card !== '1' && card !== '0..1';
    if (/^pertenece|^forma$/.test(verbo)) {
      return [{ op: 'relacion', tipo: 'Association', origen: ref(c.grupo(1)), destino: ref(c.grupo(4), plural), cardOrigen: '*', cardDestino: card === '*' ? '*' : '1', etiqueta: '' }];
    }
    return [{ op: 'relacion', tipo: 'Association', origen: ref(c.grupo(1)), destino: ref(c.grupo(4), plural), cardOrigen: '1', cardDestino: card, etiqueta: verbo === 'tiene' ? '' : verbo }];
  },
];

const interpretarFrase = (frase) => {
  const limpia = {
    norm: frase.norm.replace(/^(?:por\s+favor[,\s]+|ahora[,\s]+|luego[,\s]+|tambien[,\s]+|ademas[,\s]+|y\s+)+/, ''),
    orig: '',
  };
  limpia.orig = frase.orig.slice(frase.norm.length - limpia.norm.length);
  const sinPunto = recortar({ norm: limpia.norm.replace(/[.!?]+$/, ''), orig: limpia.orig.slice(0, limpia.norm.replace(/[.!?]+$/, '').length) });
  for (const patron of PATRONES) {
    const ops = patron(sinPunto);
    if (ops && ops.length) return ops;
  }
  return null;
};

const VERBOS_ORDEN = `(?:${V_CREAR}|${V_ELIMINAR}|${V_RENOMBRAR}|${V_CAMBIAR}|${V_RELACIONAR})`;

/**
 * @returns {{ operaciones: Array, noEntendidas: string[] }}
 */
export const interpretar = (texto) => {
  const orig = String(texto || '').normalize('NFC');
  const frases = dividir({ norm: normalizar(orig), orig }, new RegExp(`(?:[;\\n]+|\\.+(?=\\s|$))\\s*|,?\\s+(?:y\\s+(?:luego\\s+|despues\\s+)?|luego\\s+|despues\\s+|ademas\\s+|tambien\\s+)(?=${VERBOS_ORDEN}\\b)`));
  const operaciones = [];
  const noEntendidas = [];
  for (const frase of frases) {
    const ops = interpretarFrase(frase);
    if (ops) operaciones.push(...ops);
    else noEntendidas.push(frase.orig);
  }
  return { operaciones, noEntendidas };
};

// ─────────────────────────── Aplicar al diagrama ───────────────────────────

const idNuevo = (prefijo) => `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const nombreDeAtributo = (entrada) => parseAtributo(entrada).nombre;

/**
 * Ejecuta las operaciones sobre una copia del diagrama.
 * @returns {{ nodes, edges, resumen: string[], avisos: string[], cambios: number }}
 */
export const aplicarOperaciones = (operaciones, { nodes = [], edges = [] } = {}) => {
  let nodos = nodes.map((n) => ({ ...n, data: { ...n.data } }));
  let aristas = edges.map((e) => ({ ...e, data: { ...e.data } }));
  const resumen = [];
  const avisos = [];
  const nuevos = [];
  let cambios = 0;

  const esClase = (n) => n.type === 'classNode' || n.data?.className;
  const buscar = (nombre) => {
    const k = clave(nombre);
    return nodos.find((n) => esClase(n) && clave(n.data.className || '') === k) || null;
  };
  const obtener = (r, crear = true) => {
    const existente = buscar(r.nombre);
    if (existente || !crear) return existente;
    const nombre = nombreClase(r.plural ? singular(r.nombre) : r.nombre);
    const nodo = { id: idNuevo('node'), type: 'classNode', position: null, data: { className: nombre, attributes: [], methods: [] } };
    nodos.push(nodo);
    nuevos.push(nodo);
    resumen.push(`Clase ${nombre} creada`);
    cambios++;
    return nodo;
  };
  const agregarAtributos = (nodo, atributos) => {
    const existentes = new Set((nodo.data.attributes || []).map((a) => normalizar(nombreDeAtributo(a))));
    const agregados = [];
    for (const a of atributos) {
      if (existentes.has(normalizar(a.nombre))) continue;
      existentes.add(normalizar(a.nombre));
      nodo.data.attributes = [...(nodo.data.attributes || []), formatearAtributo({ visibilidad: 'private', nombre: a.nombre, tipo: a.tipo })];
      agregados.push(`${a.nombre}: ${a.tipo}`);
    }
    if (agregados.length) { resumen.push(`${nodo.data.className}: + ${agregados.join(', ')}`); cambios++; }
  };
  const agregarMetodos = (nodo, metodos) => {
    const existentes = new Set((nodo.data.methods || []).map((m) => normalizar(parseMetodo(m).nombre)));
    const agregados = [];
    for (const m of metodos) {
      if (existentes.has(normalizar(m.nombre))) continue;
      existentes.add(normalizar(m.nombre));
      nodo.data.methods = [...(nodo.data.methods || []), formatearMetodo({ visibilidad: 'public', nombre: m.nombre, parametros: m.parametros, tipoRetorno: m.tipoRetorno })];
      agregados.push(`${m.nombre}()`);
    }
    if (agregados.length) { resumen.push(`${nodo.data.className}: + ${agregados.join(', ')}`); cambios++; }
  };
  const entre = (a, b) => aristas.filter((e) => (e.source === a.id && e.target === b.id) || (e.source === b.id && e.target === a.id));

  for (const op of operaciones) {
    switch (op.op) {
      case 'plantilla':
        resumen.push(`Plantilla base para "${op.tema}"`);
        break;
      case 'clase': {
        const nodo = obtener(op.clase);
        agregarAtributos(nodo, op.atributos || []);
        agregarMetodos(nodo, op.metodos || []);
        break;
      }
      case 'atributos': {
        const nodo = obtener(op.clase);
        agregarAtributos(nodo, op.atributos || []);
        agregarMetodos(nodo, op.metodos || []);
        break;
      }
      case 'metodos':
        agregarMetodos(obtener(op.clase), op.metodos || []);
        break;
      case 'eliminarClase': {
        const nodo = buscar(op.clase.nombre);
        if (!nodo) { avisos.push(`No existe la clase ${op.clase.nombre}`); break; }
        nodos = nodos.filter((n) => n.id !== nodo.id);
        aristas = aristas.filter((e) => e.source !== nodo.id && e.target !== nodo.id);
        resumen.push(`Clase ${nodo.data.className} eliminada`);
        cambios++;
        break;
      }
      case 'renombrarClase': {
        const nodo = buscar(op.clase.nombre);
        if (!nodo) { avisos.push(`No existe la clase ${op.clase.nombre}`); break; }
        const antes = nodo.data.className;
        nodo.data.className = nombreClase(op.nuevo);
        resumen.push(`Clase ${antes} renombrada a ${nodo.data.className}`);
        cambios++;
        break;
      }
      case 'eliminarAtributo':
      case 'eliminarMetodo': {
        const nodo = buscar(op.clase.nombre);
        if (!nodo) { avisos.push(`No existe la clase ${op.clase.nombre}`); break; }
        const campo = op.op === 'eliminarAtributo' ? 'attributes' : 'methods';
        const nombreDe = op.op === 'eliminarAtributo' ? nombreDeAtributo : (m) => parseMetodo(m).nombre;
        const antes = (nodo.data[campo] || []).length;
        nodo.data[campo] = (nodo.data[campo] || []).filter((x) => normalizar(nombreDe(x)) !== normalizar(nombreMiembro(op.miembro)));
        if (nodo.data[campo].length === antes) { avisos.push(`${nodo.data.className} no tiene ${op.miembro}`); break; }
        resumen.push(`${nodo.data.className}: − ${op.miembro}`);
        cambios++;
        break;
      }
      case 'renombrarAtributo':
      case 'tipoAtributo': {
        const nodo = buscar(op.clase.nombre);
        if (!nodo) { avisos.push(`No existe la clase ${op.clase.nombre}`); break; }
        let hecho = false;
        nodo.data.attributes = (nodo.data.attributes || []).map((a) => {
          const p = parseAtributo(a);
          if (normalizar(p.nombre) !== normalizar(nombreMiembro(op.miembro))) return a;
          hecho = true;
          return formatearAtributo({ ...p, nombre: op.op === 'renombrarAtributo' ? nombreMiembro(op.nuevo) : p.nombre, tipo: op.op === 'tipoAtributo' ? op.tipo : p.tipo });
        });
        if (!hecho) { avisos.push(`${nodo.data.className} no tiene ${op.miembro}`); break; }
        resumen.push(op.op === 'renombrarAtributo' ? `${nodo.data.className}: ${op.miembro} → ${nombreMiembro(op.nuevo)}` : `${nodo.data.className}.${op.miembro}: ${op.tipo}`);
        cambios++;
        break;
      }
      case 'relacion': {
        const origen = obtener(op.origen);
        const destino = obtener(op.destino);
        if (origen.id === destino.id && op.tipo === 'Generalization') { avisos.push('Una clase no puede heredar de sí misma'); break; }
        const sinCard = op.tipo === 'Generalization' || op.tipo === 'Implementation' || op.tipo === 'Dependency';
        const data = {
          type: op.tipo,
          startLabel: sinCard ? '' : (op.cardOrigen || ''),
          endLabel: sinCard ? '' : (op.cardDestino || ''),
          label: op.etiqueta || '',
        };
        const igual = aristas.find((e) => e.source === origen.id && e.target === destino.id && e.data?.type === op.tipo && (e.data?.label || '') === data.label);
        if (igual) {
          igual.data = { ...igual.data, ...data };
        } else {
          aristas.push({ id: idNuevo('edge'), source: origen.id, target: destino.id, type: 'umlEdge', data });
        }
        const cards = sinCard ? '' : ` (${data.startLabel} — ${data.endLabel})`;
        const nombresTipo = { Association: 'Asociación', Composition: 'Composición', Aggregation: 'Agregación', Generalization: 'Herencia', Implementation: 'Implementación', Dependency: 'Dependencia' };
        resumen.push(`${nombresTipo[op.tipo]} ${origen.data.className} → ${destino.data.className}${cards}${data.label ? ` "${data.label}"` : ''}`);
        cambios++;
        break;
      }
      case 'eliminarRelacion':
      case 'cardinalidad':
      case 'tipoRelacion': {
        const a = buscar(op.a.nombre);
        const b = buscar(op.b.nombre);
        if (!a || !b) { avisos.push(`No existe la clase ${!a ? op.a.nombre : op.b.nombre}`); break; }
        const relaciones = entre(a, b);
        if (!relaciones.length) { avisos.push(`No hay relación entre ${a.data.className} y ${b.data.className}`); break; }
        if (op.op === 'eliminarRelacion') {
          const ids = new Set(relaciones.map((e) => e.id));
          aristas = aristas.filter((e) => !ids.has(e.id));
          resumen.push(`Relación ${a.data.className} — ${b.data.className} eliminada`);
        } else if (op.op === 'cardinalidad') {
          relaciones.forEach((e) => {
            const directa = e.source === a.id;
            e.data = { ...e.data, startLabel: directa ? op.cardA : op.cardB, endLabel: directa ? op.cardB : op.cardA };
          });
          resumen.push(`Cardinalidad ${a.data.className} (${op.cardA}) — (${op.cardB}) ${b.data.className}`);
        } else {
          relaciones.forEach((e) => {
            e.data = { ...e.data, type: op.tipo };
            if (op.tipo === 'Generalization' || op.tipo === 'Implementation') e.data = { ...e.data, startLabel: '', endLabel: '' };
          });
          resumen.push(`Relación ${a.data.className} — ${b.data.className} ahora es ${op.tipo}`);
        }
        cambios++;
        break;
      }
      default:
        break;
    }
  }

  ubicarNuevos(nuevos, nodos.filter((n) => !nuevos.includes(n)));
  return { nodes: nodos, edges: aristas, resumen, avisos, cambios };
};

/** Coloca las clases nuevas a la derecha de las existentes, sin encimarse. */
const ubicarNuevos = (nuevos, existentes) => {
  if (!nuevos.length) return;
  const cajas = existentes.filter((n) => n.position).map((n) => ({ ...n.position, ...tamanoNodo(n.data) }));
  const inicioX = cajas.length ? Math.max(...cajas.map((c) => c.x + c.ancho)) + 120 : 80;
  const inicioY = cajas.length ? Math.min(...cajas.map((c) => c.y)) : 80;
  const columnas = cajas.length ? 2 : 3;
  let y = inicioY;
  for (let i = 0; i < nuevos.length; i += columnas) {
    const fila = nuevos.slice(i, i + columnas);
    fila.forEach((n, j) => { n.position = { x: inicioX + j * 430, y }; });
    y += Math.max(...fila.map((n) => tamanoNodo(n.data).alto)) + 80;
  }
};

/** Frases de ejemplo para la ayuda de la burbuja. */
export const EJEMPLOS_ORDENES = [
  'crea la clase Producto con nombre texto, precio decimal y stock entero',
  'un cliente realiza muchas ventas',
  'Venta se compone de muchos DetalleVenta',
  'Estudiante hereda de Persona',
  'agrega el atributo email a Cliente',
  'elimina el atributo stock de Producto',
  'cambia la cardinalidad de Cliente a Venta a uno a muchos',
  'crea un diagrama de una biblioteca',
];
