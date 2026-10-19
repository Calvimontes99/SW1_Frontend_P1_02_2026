import { limpiar } from './operacionesDiagrama.js';

/**
 * Deshacer en un tablero compartido: revierte SOLO lo que cambió el propio usuario.
 *
 * Antes, Ctrl+Z restauraba una foto completa del diagrama y con ella se perdía lo que los
 * compañeros habían hecho después. Ahora se compara la foto de antes y la de después del cambio
 * propio, y se revierte elemento por elemento sobre el estado ACTUAL. Si otra persona tocó ese
 * elemento después, no se pisa su trabajo: se omite y se avisa.
 *
 * Rehacer es lo mismo con las fotos al revés.
 * @returns {{ estado: {nodes, edges}, omitidos: number, revertidos: number }}
 */

const canonico = (v) => {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};
const igual = (a, b) => canonico(a ? limpiar(a) : null) === canonico(b ? limpiar(b) : null);
const sinPosicion = (n) => {
  if (!n) return n;
  const { position, ...resto } = limpiar(n);
  return resto;
};
const mismoContenido = (a, b) => canonico(sinPosicion(a)) === canonico(sinPosicion(b));
const mismaPosicion = (a, b) => canonico(a?.position) === canonico(b?.position);
const porId = (lista) => new Map((lista || []).map((x) => [x.id, x]));

const revertirLista = (actual, antes, despues, esNodo, noQuitar = new Set()) => {
  const mapaAntes = porId(antes);
  const mapaDespues = porId(despues);
  let lista = [...(actual || [])];
  let omitidos = 0;
  let revertidos = 0;
  const ids = new Set([...mapaAntes.keys(), ...mapaDespues.keys()]);
  for (const id of ids) {
    const a = mapaAntes.get(id);
    const d = mapaDespues.get(id);
    if (igual(a, d)) continue;
    const i = lista.findIndex((x) => x.id === id);
    const c = i >= 0 ? lista[i] : null;
    if (!a && d) {
      // Lo había agregado: se quita, salvo que alguien lo haya editado (o conectado) después
      if (!c) continue;
      if (noQuitar.has(id)) { omitidos += 1; continue; }
      if (esNodo ? mismoContenido(c, d) : igual(c, d)) { lista.splice(i, 1); revertidos += 1; } else omitidos += 1;
    } else if (a && !d) {
      // Lo había borrado: vuelve tal como estaba
      if (!c) { lista.push(limpiar(a)); revertidos += 1; } else omitidos += 1;
    } else if (!c) {
      omitidos += 1; // lo modificó y otra persona lo borró después
    } else if (esNodo && mismoContenido(a, d)) {
      // Solo lo había movido: vuelve a su lugar si nadie lo movió de nuevo
      if (mismaPosicion(c, d)) { lista[i] = { ...c, position: a.position }; revertidos += 1; } else omitidos += 1;
    } else if (esNodo ? mismoContenido(c, d) : igual(c, d)) {
      lista[i] = esNodo ? { ...c, ...limpiar(a), position: mismaPosicion(a, d) ? c.position : a.position } : { ...c, ...limpiar(a) };
      revertidos += 1;
    } else {
      omitidos += 1;
    }
  }
  return { lista, omitidos, revertidos };
};

export const deshacerSelectivo = (actual, antes, despues) => {
  // Una clase que agregué no se quita si otra persona le conectó (o cambió) una relación después:
  // quitarla se llevaría ese trabajo ajeno
  const nodosAntes = new Set((antes?.nodes || []).map((x) => x.id));
  const aristasMias = porId(despues?.edges);
  const protegidas = new Set();
  for (const nodo of despues?.nodes || []) {
    if (nodosAntes.has(nodo.id)) continue; // no la agregué yo en este cambio
    const ajenas = (actual?.edges || []).filter((e) => (e.source === nodo.id || e.target === nodo.id)
      && (!aristasMias.has(e.id) || !igual(aristasMias.get(e.id), e)));
    if (ajenas.length) protegidas.add(nodo.id);
  }
  const n = revertirLista(actual?.nodes, antes?.nodes, despues?.nodes, true, protegidas);
  const e = revertirLista(actual?.edges, antes?.edges, despues?.edges, false);
  // Relaciones que quedaron sin una de sus clases (se quitó una clase agregada) se van también
  const ids = new Set(n.lista.map((x) => x.id));
  const aristas = e.lista.filter((x) => ids.has(x.source) && ids.has(x.target));
  return {
    estado: { nodes: n.lista, edges: aristas },
    omitidos: n.omitidos + e.omitidos,
    revertidos: n.revertidos + e.revertidos,
  };
};

export default deshacerSelectivo;
