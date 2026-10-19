/**
 * Lo que se dibuja en la pizarra encima del diagrama real, sin guardarse:
 *  - la propuesta pendiente de la IA (clases nuevas semitransparentes, atributos que se agregan en
 *    verde y que se quitan tachados, relaciones nuevas punteadas, lo que se elimina en rojo);
 *  - las observaciones de la última revisión de la IA (borde de color en la clase).
 * Los nodos "fantasma" tienen id con el prefijo PREFIJO_FANTASMA y no se pueden mover ni editar.
 */
export const PREFIJO_FANTASMA = 'propuesta-ia:';
export const esFantasma = (id) => typeof id === 'string' && id.startsWith(PREFIJO_FANTASMA);

const estiloArista = (color) => ({ stroke: color, strokeWidth: 2.5, strokeDasharray: '6 4' });

export const superponerPropuesta = (nodes, edges, propuesta, revision, medidas = {}) => {
  let nodos = nodes;
  let aristas = edges;

  if (revision?.datos?.observaciones?.length) {
    const porNodo = new Map();
    for (const o of revision.datos.observaciones) {
      if (!o.nodoId) continue;
      if (!porNodo.has(o.nodoId)) porNodo.set(o.nodoId, []);
      porNodo.get(o.nodoId).push(o);
    }
    if (porNodo.size) {
      nodos = nodos.map((n) => (porNodo.has(n.id) ? { ...n, data: { ...n.data, _observaciones: porNodo.get(n.id) } } : n));
    }
  }

  if (!propuesta || propuesta.estado !== 'pendiente') return { nodos, aristas };
  const ops = propuesta.operaciones || [];
  const idFantasma = (id) => `${PREFIJO_FANTASMA}${propuesta.id}:${id}`;
  const nuevas = new Set(ops.filter((o) => o.op === 'agregarClase').map((o) => o.id));
  const resolver = (id) => (nuevas.has(id) ? idFantasma(id) : id);

  const porId = new Map(ops.filter((o) => o.id).map((o) => [o.id, o]));
  nodos = nodos.map((n) => {
    const op = porId.get(n.id);
    if (!op) return n;
    if (op.op === 'eliminarClase') return { ...n, data: { ...n.data, _propuesta: 'eliminada' } };
    if (op.op === 'modificarClase') {
      const a = op.antes;
      const d = op.despues;
      return {
        ...n,
        data: {
          ...n.data,
          _propuesta: 'modificada',
          _propuestaCambios: {
            nombreNuevo: a.nombre !== d.nombre ? d.nombre : null,
            atributos: d.atributos,
            atributosNuevos: d.atributos.filter((x) => !a.atributos.includes(x)),
            atributosQuitados: a.atributos.filter((x) => !d.atributos.includes(x)),
            metodos: d.metodos,
            metodosNuevos: d.metodos.filter((x) => !a.metodos.includes(x)),
            metodosQuitados: a.metodos.filter((x) => !d.metodos.includes(x)),
          },
        },
      };
    }
    return n;
  });

  const fantasmas = ops.filter((o) => o.op === 'agregarClase' && o.nodo).map((o) => {
    const id = idFantasma(o.id);
    return {
      ...o.nodo,
      id,
      draggable: false,
      selectable: false,
      connectable: false,
      ...(medidas[id] ? { measured: medidas[id] } : {}),
      data: { ...(o.nodo.data || {}), _propuesta: 'nueva' },
    };
  });

  aristas = aristas.map((e) => {
    const op = porId.get(e.id);
    if (op?.op === 'eliminarRelacion') return { ...e, animated: false, style: estiloArista('#dc2626'), data: { ...e.data, _propuesta: 'eliminada' } };
    if (op?.op === 'modificarRelacion') return { ...e, style: estiloArista('#d97706'), data: { ...e.data, ...op.datos, _propuesta: 'modificada' } };
    return e;
  });
  const aristasNuevas = ops.filter((o) => o.op === 'agregarRelacion' && o.arista).map((o) => ({
    ...o.arista,
    id: idFantasma(o.id),
    source: resolver(o.arista.source),
    target: resolver(o.arista.target),
    selectable: false,
    animated: true,
    style: estiloArista('#16a34a'),
    data: { ...(o.arista.data || {}), _propuesta: 'nueva' },
  }));

  return { nodos: [...nodos, ...fantasmas], aristas: [...aristas, ...aristasNuevas] };
};
