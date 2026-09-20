/**
 * Gramática UML 2.5 para atributos y métodos.
 *
 * El diagrama se sigue guardando con atributos y métodos como CADENAS, para que
 * los tableros existentes sigan abriendo sin migración. Este módulo formaliza
 * cómo se leen y escriben esas cadenas, y es la única fuente de la verdad para
 * el editor, el validador de IA y los exportadores.
 *
 *   Atributo: [+|-|#|~] nombre: Tipo [= valorPorDefecto]
 *   Método:   [+|-|#|~] nombre(param: Tipo, ...): TipoRetorno
 *
 * Sin símbolo de visibilidad se asume `-` (private), que es lo que venían
 * generando los exportadores para los diagramas antiguos.
 */

export const VISIBILIDADES = {
  '+': 'public',
  '-': 'private',
  '#': 'protected',
  '~': 'package',
};

export const SIMBOLO_POR_VISIBILIDAD = {
  public: '+',
  private: '-',
  protected: '#',
  package: '~',
};

/** Estereotipos de clase soportados (UML 2.5). */
export const ESTEREOTIPOS = [
  { value: '', label: 'Clase normal' },
  { value: 'abstract', label: 'Clase abstracta' },
  { value: 'interface', label: 'Interfaz' },
  { value: 'enumeration', label: 'Enumeración' },
];

const separarVisibilidad = (texto) => {
  const limpio = String(texto ?? '').trim();
  const m = limpio.match(/^([+\-#~])\s*(.*)$/);
  if (m) return { visibilidad: VISIBILIDADES[m[1]], resto: m[2].trim() };
  return { visibilidad: 'private', resto: limpio };
};

/**
 * Parsea un atributo. Acepta tanto el formato nuevo como el antiguo
 * ("nombre: tipo" sin visibilidad) y objetos ya estructurados.
 */
export const parseAtributo = (entrada) => {
  if (entrada && typeof entrada === 'object') {
    return {
      visibilidad: entrada.visibility || entrada.visibilidad || 'private',
      nombre: entrada.name || entrada.nombre || 'atributo',
      tipo: entrada.type || entrada.tipo || 'String',
      valorPorDefecto: entrada.defaultValue ?? entrada.valorPorDefecto ?? null,
    };
  }

  const { visibilidad, resto } = separarVisibilidad(entrada);
  if (!resto) return { visibilidad, nombre: 'atributo', tipo: 'String', valorPorDefecto: null };

  // nombre: Tipo = valor
  let valorPorDefecto = null;
  let cuerpo = resto;
  const igual = cuerpo.indexOf('=');
  if (igual !== -1) {
    valorPorDefecto = cuerpo.slice(igual + 1).trim() || null;
    cuerpo = cuerpo.slice(0, igual).trim();
  }

  const dosPuntos = cuerpo.indexOf(':');
  if (dosPuntos === -1) {
    return { visibilidad, nombre: cuerpo.trim() || 'atributo', tipo: 'String', valorPorDefecto };
  }
  return {
    visibilidad,
    nombre: cuerpo.slice(0, dosPuntos).trim() || 'atributo',
    tipo: cuerpo.slice(dosPuntos + 1).trim() || 'String',
    valorPorDefecto,
  };
};

/**
 * Parsea un método con sus parámetros y tipo de retorno.
 * Ej.: "+ calcularTotal(descuento: double): double"
 */
export const parseMetodo = (entrada) => {
  if (entrada && typeof entrada === 'object') {
    return {
      visibilidad: entrada.visibility || entrada.visibilidad || 'public',
      nombre: entrada.name || entrada.nombre || 'metodo',
      // Los parámetros pueden venir con claves en inglés ({ name, type })
      parametros: (entrada.parameters || entrada.parametros || []).map((p) => ({
        nombre: String(p?.nombre ?? p?.name ?? 'param'),
        tipo: String(p?.tipo ?? p?.type ?? 'String'),
      })),
      tipoRetorno: entrada.returnType || entrada.tipoRetorno || 'void',
    };
  }

  const { visibilidad, resto } = separarVisibilidad(entrada);
  // Los métodos son públicos por defecto salvo que se indique lo contrario
  const visibilidadFinal = /^[+\-#~]/.test(String(entrada ?? '').trim()) ? visibilidad : 'public';

  const abre = resto.indexOf('(');
  const cierra = resto.lastIndexOf(')');
  if (abre === -1 || cierra === -1 || cierra < abre) {
    return { visibilidad: visibilidadFinal, nombre: resto.trim() || 'metodo', parametros: [], tipoRetorno: 'void' };
  }

  const nombre = resto.slice(0, abre).trim() || 'metodo';
  const dentro = resto.slice(abre + 1, cierra).trim();
  const despues = resto.slice(cierra + 1).trim();
  const tipoRetorno = despues.startsWith(':') ? (despues.slice(1).trim() || 'void') : 'void';

  const parametros = dentro
    ? dentro.split(',').map((p) => {
        const partes = p.split(':');
        return {
          nombre: (partes[0] || 'param').trim(),
          tipo: (partes[1] || 'String').trim(),
        };
      })
    : [];

  return { visibilidad: visibilidadFinal, nombre, parametros, tipoRetorno };
};

/** Vuelve a la cadena canónica de un atributo. */
export const formatearAtributo = (a) => {
  const simbolo = SIMBOLO_POR_VISIBILIDAD[a.visibilidad] || '-';
  const base = `${simbolo} ${a.nombre}: ${a.tipo}`;
  return a.valorPorDefecto ? `${base} = ${a.valorPorDefecto}` : base;
};

/** Vuelve a la cadena canónica de un método. */
export const formatearMetodo = (m) => {
  const simbolo = SIMBOLO_POR_VISIBILIDAD[m.visibilidad] || '+';
  const params = (m.parametros || []).map((p) => `${p.nombre}: ${p.tipo}`).join(', ');
  return `${simbolo} ${m.nombre}(${params}): ${m.tipoRetorno || 'void'}`;
};

/**
 * Cómo mostrar un atributo/método en el nodo del diagrama: se antepone el
 * símbolo de visibilidad aunque la cadena guardada no lo traiga.
 */
export const mostrarAtributo = (entrada) => formatearAtributo(parseAtributo(entrada));
export const mostrarMetodo = (entrada) => formatearMetodo(parseMetodo(entrada));

/** Etiqueta «interface» / «enumeration» que se pinta sobre el nombre. */
export const etiquetaEstereotipo = (estereotipo) => {
  if (estereotipo === 'interface') return '«interface»';
  if (estereotipo === 'enumeration') return '«enumeration»';
  return null;
};

export default {
  VISIBILIDADES,
  SIMBOLO_POR_VISIBILIDAD,
  ESTEREOTIPOS,
  parseAtributo,
  parseMetodo,
  formatearAtributo,
  formatearMetodo,
  mostrarAtributo,
  mostrarMetodo,
  etiquetaEstereotipo,
};
