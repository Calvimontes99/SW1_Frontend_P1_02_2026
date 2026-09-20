/**
 * Importación de proyectos de Enterprise Architect (.EAP).
 *
 * El backend lee la base del proyecto (POST /apis/importar/eap) y devuelve un
 * modelo intermedio con clases, conectores y diagramas. Aquí se decide qué se
 * puede importar (cada diagrama con clases, o todas las clases) y se convierte
 * la opción elegida en nodos y aristas del editor, con la disposición del
 * lienzo de EA.
 */

import { formatearAtributo, formatearMetodo } from './umlParser.js';
import { distribuirNodos } from './distribucionImportada.js';

/** EA guarda "1..1" o "0..*"; el editor usa "1" y "*". */
export const normalizarCardinalidad = (valor) => {
  const t = String(valor ?? '').trim();
  if (!t) return '';
  if (t === '0..*' || t === '*') return '*';
  const m = t.match(/^(\d+)\.\.(\d+)$/);
  return m && m[1] === m[2] ? m[1] : t;
};

const estereotipoDe = (clase) => {
  if (clase.tipo === 'Interface' || clase.estereotipo === 'interface') return 'interface';
  if (clase.tipo === 'Enumeration' || clase.estereotipo === 'enumeration') return 'enumeration';
  return clase.abstracta ? 'abstract' : null;
};

const idNodo = (id) => `node-eap-${id}`;

/**
 * @param {{paquetes, clases, conectores, diagramas}} modelo respuesta del backend
 * @returns {{ opciones: Array<{valor: string, etiqueta: string}>, construir: (valor?: string) => {nodes, edges, titulo} }}
 */
export const prepararImportacionEAP = (modelo) => {
  const clasesModelo = modelo?.clases || [];
  const diagramas = modelo?.diagramas || [];
  const conectores = modelo?.conectores || [];
  if (!clasesModelo.length) {
    throw new Error('El proyecto de Enterprise Architect no contiene clases.');
  }

  const opciones = diagramas.map((d) => ({
    valor: `diagrama:${d.id}`,
    etiqueta: `${d.nombrePaquete ? `${d.nombrePaquete} › ` : ''}${d.nombre} (${new Set(d.objetos.map((o) => o.clase)).size} clases)`,
  }));
  const enAlgunDiagrama = new Set(diagramas.flatMap((d) => d.objetos.map((o) => o.clase)));
  if (opciones.length !== 1 || clasesModelo.some((c) => !enAlgunDiagrama.has(c.id))) {
    opciones.push({ valor: 'todo', etiqueta: `Todas las clases del proyecto (${clasesModelo.length})` });
  }

  const construir = (valor = opciones[0].valor) => {
    const diagrama = diagramas.find((d) => `diagrama:${d.id}` === valor) || null;
    const posiciones = new Map();
    if (diagrama) {
      diagrama.objetos.forEach((o) => {
        if (!posiciones.has(o.clase)) posiciones.set(o.clase, { x: o.left, y: o.top });
      });
    } else {
      // "Todas": cada clase conserva la posición de su primer diagrama y los
      // diagramas se apilan uno debajo de otro para no encimarse entre sí
      let desplazamientoY = 0;
      diagramas.forEach((d) => {
        const propios = d.objetos.filter((o) => !posiciones.has(o.clase));
        if (!propios.length) return;
        const minX = Math.min(...propios.map((o) => o.left));
        const minY = Math.min(...propios.map((o) => o.top));
        const maxY = Math.max(...propios.map((o) => o.bottom));
        propios.forEach((o) => posiciones.set(o.clase, { x: o.left - minX, y: o.top - minY + desplazamientoY }));
        desplazamientoY += maxY - minY + 80;
      });
    }

    const clases = diagrama ? clasesModelo.filter((c) => posiciones.has(c.id)) : clasesModelo;
    const incluidas = new Set(clases.map((c) => c.id));

    const nodes = clases.map((c) => {
      const estereotipo = estereotipoDe(c);
      const attributes =
        estereotipo === 'enumeration'
          ? c.atributos.map((a) => a.nombre).filter(Boolean)
          : c.atributos.map((a) =>
              formatearAtributo({
                visibilidad: a.visibilidad,
                nombre: a.nombre || 'atributo',
                tipo: a.tipo || 'String',
                valorPorDefecto: a.valorPorDefecto,
              })
            );
      const methods = c.operaciones.map((o) =>
        formatearMetodo({
          visibilidad: o.visibilidad,
          nombre: o.nombre || 'metodo',
          parametros: o.parametros.map((p) => ({ nombre: p.nombre, tipo: p.tipo || 'String' })),
          tipoRetorno: o.tipoRetorno || 'void',
        })
      );
      return {
        id: idNodo(c.id),
        type: 'classNode',
        position: posiciones.get(c.id),
        data: { className: c.nombre, stereotype: estereotipo, attributes, methods },
      };
    });

    const ocultos = new Set(diagrama?.conectoresOcultos || []);
    const edges = conectores
      .filter((k) => incluidas.has(k.origen) && incluidas.has(k.destino) && !ocultos.has(k.id))
      .map((k) => {
        let origen = { clase: k.origen, card: k.cardOrigen, rol: k.rolOrigen };
        let destino = { clase: k.destino, card: k.cardDestino, rol: k.rolDestino };
        let tipo;
        if (k.tipo === 'Generalization') tipo = 'Generalization';
        else if (k.tipo === 'Realisation' || k.tipo === 'Realization') tipo = 'Implementation';
        else if (k.tipo === 'Dependency') tipo = 'Dependency';
        else {
          // EA marca el extremo "todo" (donde va el rombo) con 1 = agregación y
          // 2 = composición. El editor dibuja el rombo en el destino de la arista.
          const nivel = Math.max(k.agregadoOrigen, k.agregadoDestino);
          const compuesta =
            k.tipo === 'Composition' || nivel === 2 || (k.tipo === 'Aggregation' && /strong/i.test(k.subtipo));
          tipo = compuesta ? 'Composition' : nivel === 1 || k.tipo === 'Aggregation' ? 'Aggregation' : 'Association';
          if (k.agregadoOrigen > 0 && k.agregadoDestino === 0) [origen, destino] = [destino, origen];
        }
        return {
          id: `edge-eap-${k.id}`,
          source: idNodo(origen.clase),
          target: idNodo(destino.clase),
          type: 'umlEdge',
          data: {
            type: tipo,
            label: k.nombre,
            startLabel: normalizarCardinalidad(origen.card),
            endLabel: normalizarCardinalidad(destino.card),
            sourceRole: origen.rol,
            targetRole: destino.rol,
          },
        };
      });

    return { nodes: distribuirNodos(nodes), edges, titulo: diagrama?.nombre || null };
  };

  return { opciones, construir };
};

export default prepararImportacionEAP;
