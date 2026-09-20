/**
 * Distribución en el lienzo de las clases que llegan de una importación.
 *
 * Las coordenadas de Enterprise Architect son de cajas pequeñas (unos 100 px de
 * ancho), pero en el editor cada clase mide 340 px y crece con sus atributos: usadas
 * tal cual, las clases quedan unas encima de otras. Se conserva la disposición
 * original escalándola lo justo para que no se solapen. Las clases sin posición se
 * reparten en una cuadrícula debajo, con filas de la altura de su clase más alta.
 */

// .class-node (index.css): 340 px de ancho + borde, 20 px de relleno, 16 px por línea
const ANCHO_NODO = 346;
const MARGEN = 40;
const ORIGEN = { x: 80, y: 80 };

/** Tamaño aproximado con el que el editor dibuja una clase. */
export const tamanoNodo = (data = {}) => {
  const atributos = Array.isArray(data.attributes) ? data.attributes.length : 0;
  const metodos = Array.isArray(data.methods) ? data.methods.length : 0;
  const secciones = (atributos ? 1 : 0) + (metodos ? 1 : 0);
  return {
    ancho: ANCHO_NODO,
    alto: 94 + secciones * 30 + (atributos + metodos) * 23 + (data.stereotype ? 20 : 0),
  };
};

const haySolapamiento = (cajas) => {
  for (let i = 0; i < cajas.length; i++) {
    for (let j = i + 1; j < cajas.length; j++) {
      const a = cajas[i];
      const b = cajas[j];
      if (
        a.x < b.x + b.ancho + MARGEN && b.x < a.x + a.ancho + MARGEN &&
        a.y < b.y + b.alto + MARGEN && b.y < a.y + a.alto + MARGEN
      ) {
        return true;
      }
    }
  }
  return false;
};

/**
 * @param {Array} nodes nodos del editor; `position` puede faltar
 * @returns {Array} los mismos nodos con una posición que no se solapa
 */
export const distribuirNodos = (nodes) => {
  const conPosicion = nodes.filter((n) => Number.isFinite(n.position?.x) && Number.isFinite(n.position?.y));
  const sinPosicion = nodes.filter((n) => !conPosicion.includes(n));
  const posiciones = new Map();
  let fondo = ORIGEN.y;

  if (conPosicion.length) {
    const minX = Math.min(...conPosicion.map((n) => n.position.x));
    const minY = Math.min(...conPosicion.map((n) => n.position.y));
    const base = conPosicion.map((n) => ({
      id: n.id,
      x: n.position.x - minX,
      y: n.position.y - minY,
      ...tamanoNodo(n.data),
    }));

    let escala = 1;
    let cajas;
    for (;;) {
      cajas = base.map((b) => ({ ...b, x: ORIGEN.x + b.x * escala, y: ORIGEN.y + b.y * escala }));
      if (!haySolapamiento(cajas) || escala >= 12) break;
      escala = Math.round((escala + 0.1) * 10) / 10;
    }
    cajas.forEach((c) => posiciones.set(c.id, { x: Math.round(c.x), y: Math.round(c.y) }));
    fondo = Math.max(...cajas.map((c) => c.y + c.alto)) + MARGEN * 2;
  }

  if (sinPosicion.length) {
    const columnas = Math.max(1, Math.ceil(Math.sqrt(sinPosicion.length)));
    let y = fondo;
    for (let i = 0; i < sinPosicion.length; i += columnas) {
      const fila = sinPosicion.slice(i, i + columnas);
      fila.forEach((n, j) => posiciones.set(n.id, { x: ORIGEN.x + j * (ANCHO_NODO + MARGEN * 2), y }));
      y += Math.max(...fila.map((n) => tamanoNodo(n.data).alto)) + MARGEN * 2;
    }
  }

  return nodes.map((n) => ({ ...n, position: posiciones.get(n.id) || n.position || { ...ORIGEN } }));
};

export default distribuirNodos;
