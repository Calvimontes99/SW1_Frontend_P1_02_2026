/**
 * Importación de XMI: 2.1 de Enterprise Architect y 2.5.1 / UML 2.5.
 *
 * Reemplaza al importador original, que solo leía el NOMBRE de cada clase:
 * descartaba atributos y métodos (los sustituía por marcadores fijos) y su
 * bucle de relaciones tenía el cuerpo vacío, así que nunca producía aristas.
 *
 * Lee clases, interfaces, enumeraciones, atributos con visibilidad, tipo y
 * valor por defecto, operaciones con parámetros, asociaciones (con
 * cardinalidades, roles y agregación/composición), generalizaciones,
 * realizaciones y dependencias. Si el archivo trae diagramas de EA, las clases
 * conservan la disposición del lienzo y, si hay varios, se puede elegir cuál
 * importar.
 */

import { formatearAtributo, formatearMetodo } from './umlParser.js';
import { distribuirNodos } from './distribucionImportada.js';

const VIS_VALIDAS = ['public', 'private', 'protected', 'package'];

const attr = (el, nombre) =>
  el?.getAttribute?.(nombre) ||
  el?.getAttribute?.(`xmi:${nombre}`) ||
  el?.getAttributeNS?.('http://www.omg.org/spec/XMI/20131001', nombre) ||
  null;

/** Los hijos directos con ese nombre local (evita capturar los de clases anidadas). */
const hijosPorNombre = (el, nombreLocal) =>
  Array.from(el?.children || []).filter(
    (c) => c.localName === nombreLocal || c.nodeName === nombreLocal || c.nodeName.endsWith(`:${nombreLocal}`)
  );

/** Tipo XMI del elemento (uml:Class, uml:Association...). */
const tipoXmi = (el) => attr(el, 'type') || '';

/** Referencia de un atributo que puede venir como atributo XML o como hijo con xmi:idref. */
const referencia = (el, nombre) => {
  const directo = el?.getAttribute?.(nombre);
  if (directo) return directo.trim().split(/\s+/)[0];
  const hijo = hijosPorNombre(el, nombre)[0];
  return hijo ? attr(hijo, 'idref') || hijo.getAttribute('href') || '' : '';
};

const visibilidadDe = (el, porDefecto) => {
  const v = el.getAttribute('visibility');
  return VIS_VALIDAS.includes(v) ? v : porDefecto;
};

/** Convierte lower/upper de UML a la etiqueta que usa el editor. */
const etiquetaCardinalidad = (el) => {
  const lower = hijosPorNombre(el, 'lowerValue')[0]?.getAttribute('value');
  const upper = hijosPorNombre(el, 'upperValue')[0]?.getAttribute('value');
  if (lower == null && upper == null) return '';
  const l = lower ?? '1';
  const u = upper ?? '1';
  if (u === '*' || u === '-1') return l === '0' ? '*' : `${l}..*`;
  if (l === u) return l;
  return `${l}..${u}`;
};

const estereotipoDe = (tipo) => {
  if (tipo.endsWith('Interface')) return 'interface';
  if (tipo.endsWith('Enumeration')) return 'enumeration';
  return null;
};

const esAgregacion = (v) => v === 'composite' || v === 'shared';

/**
 * Analiza un XMI y devuelve qué se puede importar (cada diagrama con clases o
 * todas las clases) y la función que construye el tablero de la opción elegida.
 * @returns {{ opciones: Array<{valor: string, etiqueta: string}>, construir: (valor?: string) => {nodes, edges, titulo} }}
 */
export const prepararImportacionXmi = (xmlText) => {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');

  const errorParseo = doc.getElementsByTagName('parsererror')[0];
  if (errorParseo) {
    console.warn('XML inválido:', errorParseo.textContent.slice(0, 200));
    throw new Error('El archivo no es un XML válido. Verifica que sea una exportación XMI de Enterprise Architect u otra herramienta UML.');
  }

  const elementos = Array.from(doc.getElementsByTagName('*'));

  // Índices por xmi:id (el primero gana: el modelo va antes que la extensión de EA)
  const porId = new Map();
  const nombrePorId = new Map();
  elementos.forEach((el) => {
    const id = attr(el, 'id');
    if (!id || porId.has(id)) return;
    porId.set(id, el);
    const nombre = el.getAttribute('name');
    if (nombre) nombrePorId.set(id, nombre);
  });

  /**
   * Nombre legible de un tipo: resuelve referencias a clases o tipos
   * primitivos declarados, hrefs a los primitivos de UML
   * (".../PrimitiveTypes.xmi#String") y los "EAJava_String" de EA.
   */
  const nombreDeTipo = (el, porDefecto) => {
    const ref = referencia(el, 'type');
    if (!ref || ref.startsWith('uml:')) return porDefecto;
    if (nombrePorId.has(ref)) return nombrePorId.get(ref);
    const limpio = ref.split('#').pop().split('/').pop().replace(/^EA[A-Za-z]*_/, '');
    return limpio || porDefecto;
  };

  const empaquetados = elementos.filter(
    (el) => el.localName === 'packagedElement' || el.nodeName.endsWith('packagedElement')
  );

  const clasificadores = empaquetados.filter((el) => {
    const t = tipoXmi(el);
    return t.endsWith('Class') || t.endsWith('Interface') || t.endsWith('Enumeration');
  });

  if (clasificadores.length === 0) {
    throw new Error('No se encontraron clases en el archivo XMI.');
  }
  const idsClasificadores = new Set(clasificadores.map((c) => attr(c, 'id')));

  // Diagramas de Enterprise Architect, con la caja de cada clase
  const diagramas = elementos
    .filter((el) => el.localName === 'diagram')
    .map((d, i) => {
      const posiciones = new Map();
      Array.from(d.getElementsByTagName('element')).forEach((e) => {
        const sujeto = e.getAttribute('subject');
        const geometria = e.getAttribute('geometry') || '';
        const m = /Left=(-?\d+);Top=(-?\d+);/.exec(geometria);
        if (sujeto && m && idsClasificadores.has(sujeto) && !posiciones.has(sujeto)) {
          // En la base de EA la Y se guarda en negativo; en el XMI, en positivo
          const y = Math.abs(Number(m[2]));
          const abajo = /Bottom=(-?\d+);/.exec(geometria);
          posiciones.set(sujeto, { x: Number(m[1]), y, bottom: abajo ? Math.abs(Number(abajo[1])) : y + 100 });
        }
      });
      return {
        valor: `diagrama:${attr(d, 'id') || i}`,
        nombre: hijosPorNombre(d, 'properties')[0]?.getAttribute('name') || `Diagrama ${i + 1}`,
        posiciones,
      };
    })
    .filter((d) => d.posiciones.size > 0);

  // Conectores de la extensión de EA: dicen qué extremo es el "todo" (el rombo)
  const conectoresEA = new Map();
  elementos
    .filter((el) => el.localName === 'connector' && attr(el, 'idref'))
    .forEach((c) => {
      const origen = hijosPorNombre(c, 'source')[0];
      const destino = hijosPorNombre(c, 'target')[0];
      const agregacion = (e) => hijosPorNombre(e, 'type')[0]?.getAttribute('aggregation') || 'none';
      conectoresEA.set(attr(c, 'idref'), {
        origen: attr(origen, 'idref'),
        destino: attr(destino, 'idref'),
        agregacionOrigen: origen ? agregacion(origen) : 'none',
        agregacionDestino: destino ? agregacion(destino) : 'none',
      });
    });

  // Nombre del modelo: el paquete exportado o, si no, el propio modelo
  const modelo = elementos.find((el) => el.localName === 'Model');
  const primerPaquete = hijosPorNombre(modelo, 'packagedElement').find((p) => tipoXmi(p).endsWith('Package'));
  const nombreModelo =
    primerPaquete?.getAttribute('name') ||
    (modelo?.getAttribute('name') !== 'EA_Model' ? modelo?.getAttribute('name') : '') ||
    null;

  const opciones = diagramas.map((d) => ({ valor: d.valor, etiqueta: `${d.nombre} (${d.posiciones.size} clases)` }));
  const enAlgunDiagrama = new Set(diagramas.flatMap((d) => [...d.posiciones.keys()]));
  if (opciones.length !== 1 || clasificadores.some((c) => !enAlgunDiagrama.has(attr(c, 'id')))) {
    opciones.push({ valor: 'todo', etiqueta: `Todas las clases del archivo (${clasificadores.length})` });
  }

  const construir = (valor = opciones[0].valor) => {
    const diagrama = diagramas.find((d) => d.valor === valor) || null;
    const posiciones = new Map();
    if (diagrama) {
      diagrama.posiciones.forEach((p, xmiId) => posiciones.set(xmiId, { x: p.x, y: p.y }));
    } else {
      // "Todas": cada clase conserva la posición de su primer diagrama y los
      // diagramas se apilan uno debajo de otro para no encimarse entre sí
      let desplazamientoY = 0;
      diagramas.forEach((d) => {
        const propias = [...d.posiciones.entries()].filter(([xmiId]) => !posiciones.has(xmiId));
        if (!propias.length) return;
        const minX = Math.min(...propias.map(([, p]) => p.x));
        const minY = Math.min(...propias.map(([, p]) => p.y));
        const maxY = Math.max(...propias.map(([, p]) => p.bottom));
        propias.forEach(([xmiId, p]) => posiciones.set(xmiId, { x: p.x - minX, y: p.y - minY + desplazamientoY }));
        desplazamientoY += maxY - minY + 80;
      });
    }
    const incluidos = diagrama
      ? clasificadores.filter((c) => posiciones.has(attr(c, 'id')))
      : clasificadores;

    // ---------- Nodos ----------
    const idPorXmi = new Map();
    const nodes = incluidos.map((cls, index) => {
      const xmiId = attr(cls, 'id') || `cls_${index}`;
      const nodeId = `node-${xmiId}`;
      idPorXmi.set(xmiId, nodeId);

      const tipo = tipoXmi(cls);
      const estereotipo =
        estereotipoDe(tipo) || (cls.getAttribute('isAbstract') === 'true' ? 'abstract' : null);

      let attributes;
      if (estereotipo === 'enumeration') {
        attributes = hijosPorNombre(cls, 'ownedLiteral')
          .map((l) => l.getAttribute('name'))
          .filter(Boolean);
      } else {
        attributes = hijosPorNombre(cls, 'ownedAttribute')
          // Un ownedAttribute que apunta a una asociación es un extremo de relación,
          // no un atributo de datos: se omite para no duplicarlo en la clase.
          .filter((a) => !a.getAttribute('association'))
          .map((a) =>
            formatearAtributo({
              visibilidad: visibilidadDe(a, 'private'),
              nombre: a.getAttribute('name') || 'atributo',
              tipo: nombreDeTipo(a, 'String'),
              valorPorDefecto:
                a.getAttribute('default') ||
                hijosPorNombre(a, 'defaultValue')[0]?.getAttribute('value') ||
                null,
            })
          );
      }

      const methods = hijosPorNombre(cls, 'ownedOperation').map((op) => {
        const params = hijosPorNombre(op, 'ownedParameter');
        const retorno = params.find((p) => p.getAttribute('direction') === 'return');
        const entrada = params.filter((p) => p.getAttribute('direction') !== 'return');
        return formatearMetodo({
          visibilidad: visibilidadDe(op, 'public'),
          nombre: op.getAttribute('name') || 'metodo',
          parametros: entrada.map((p) => ({
            nombre: p.getAttribute('name') || 'param',
            tipo: nombreDeTipo(p, 'String'),
          })),
          tipoRetorno: retorno ? nombreDeTipo(retorno, 'void') : 'void',
        });
      });

      return {
        id: nodeId,
        type: 'classNode',
        position: posiciones.get(xmiId),
        data: {
          className: cls.getAttribute('name') || `Clase${index + 1}`,
          stereotype: estereotipo,
          attributes,
          methods,
        },
      };
    });

    // ---------- Aristas ----------
    const edges = [];
    const agregarArista = (id, source, target, data) => {
      if (!source || !target) return;
      edges.push({ id, source, target, type: 'umlEdge', data });
    };

    // Generalizaciones y realizaciones de interfaz (anidadas en la clase hija)
    incluidos.forEach((cls) => {
      const xmiHijo = attr(cls, 'id');
      const hijoId = idPorXmi.get(xmiHijo);
      hijosPorNombre(cls, 'generalization').forEach((gen, i) => {
        agregarArista(`edge-${attr(gen, 'id') || `gen-${xmiHijo}-${i}`}`, hijoId, idPorXmi.get(referencia(gen, 'general')), {
          type: 'Generalization',
          startLabel: '',
          endLabel: '',
        });
      });
      hijosPorNombre(cls, 'interfaceRealization').forEach((real, i) => {
        agregarArista(
          `edge-${attr(real, 'id') || `real-${xmiHijo}-${i}`}`,
          hijoId,
          idPorXmi.get(referencia(real, 'contract') || referencia(real, 'supplier')),
          { type: 'Implementation', startLabel: '', endLabel: '' }
        );
      });
    });

    /**
     * Ordena los extremos de una asociación como [origen, destino]. Los ids
     * lo indican en los archivos de EA ("EAID_src…"/"EAID_dst…") y en los de
     * versiones anteriores del exportador ("…_end1"/"…_end2"). Si no, el
     * extremo que declara la agregación está tipado por la parte, que es el
     * origen: el editor dibuja el rombo en el destino.
     */
    const ordenarExtremos = ([a, b]) => {
      const esOrigen = (e) => /^EAID_src/.test(attr(e, 'id') || '') || /_end1$/.test(attr(e, 'id') || '');
      const esDestino = (e) => /^EAID_dst/.test(attr(e, 'id') || '') || /_end2$/.test(attr(e, 'id') || '');
      if (esOrigen(b) || esDestino(a)) return [b, a];
      if (esOrigen(a) || esDestino(b)) return [a, b];
      const agrega = (e) => esAgregacion(e.getAttribute('aggregation'));
      return agrega(b) && !agrega(a) ? [b, a] : [a, b];
    };

    empaquetados
      .filter((el) => tipoXmi(el).endsWith('Association'))
      .forEach((asoc, index) => {
        let extremos = hijosPorNombre(asoc, 'ownedEnd');
        if (extremos.length < 2) {
          // Variante en la que los extremos son ownedAttribute de las clases
          extremos = hijosPorNombre(asoc, 'memberEnd')
            .map((m) => porId.get(attr(m, 'idref')))
            .filter(Boolean);
        }
        if (extremos.length < 2) return;

        let [origen, destino] = ordenarExtremos(extremos.slice(0, 2));
        let agregacion = [origen, destino].map((e) => e.getAttribute('aggregation')).find(esAgregacion);

        // Si EA describe el conector, su extremo "todo" pasa a ser el destino
        const conector = conectoresEA.get(attr(asoc, 'id'));
        const agregacionEA =
          conector && [conector.agregacionOrigen, conector.agregacionDestino].find(esAgregacion);
        if (agregacionEA) {
          agregacion = agregacionEA;
          const todo = esAgregacion(conector.agregacionDestino) ? conector.destino : conector.origen;
          if (referencia(origen, 'type') === todo && referencia(destino, 'type') !== todo) {
            [origen, destino] = [destino, origen];
          }
        }

        agregarArista(
          `edge-${attr(asoc, 'id') || `assoc_${index}`}`,
          idPorXmi.get(referencia(origen, 'type')),
          idPorXmi.get(referencia(destino, 'type')),
          {
            type: agregacion === 'composite' ? 'Composition' : agregacion === 'shared' ? 'Aggregation' : 'Association',
            startLabel: etiquetaCardinalidad(origen),
            endLabel: etiquetaCardinalidad(destino),
            sourceRole: origen.getAttribute('name') || '',
            targetRole: destino.getAttribute('name') || '',
            label: asoc.getAttribute('name') || '',
          }
        );
      });

    // Dependencias y realizaciones declaradas como elementos del paquete
    empaquetados
      .filter((el) => /(Dependency|Usage|Abstraction|Realization)$/.test(tipoXmi(el)))
      .forEach((rel, index) => {
        agregarArista(
          `edge-${attr(rel, 'id') || `dep_${index}`}`,
          idPorXmi.get(referencia(rel, 'client')),
          idPorXmi.get(referencia(rel, 'supplier')),
          {
            type: /Realization$/.test(tipoXmi(rel)) ? 'Implementation' : 'Dependency',
            startLabel: '',
            endLabel: '',
            label: rel.getAttribute('name') || '',
          }
        );
      });

    return { nodes: distribuirNodos(nodes), edges, titulo: diagrama?.nombre || nombreModelo };
  };

  return { opciones, construir };
};

/** Importa todas las clases del archivo (con la disposición de los diagramas que las contengan). */
export const processXml = (xmlText) => prepararImportacionXmi(xmlText).construir('todo');

export default processXml;
