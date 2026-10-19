// Casos de la auditoría del 14/10/2026 (auditoria-2026-10-14/README.md), comprobando el
// comportamiento CORRECTO con los módulos reales. Desde frontend/: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Sincronia, conservarTransitorios, MAX_POR_TANDA } from '../src/utils/sincronia.js';
import { aplicarOps, opsEntre } from '../src/utils/operacionesDiagrama.js';
import { deshacerSelectivo } from '../src/utils/deshacerSelectivo.js';
import { fusionarPorId } from '../src/utils/fusionHistorial.js';
import { leerSincronia } from '../src/offline/almacenTableros.js';

const clase = (id, nombre = id) => ({ id, type: 'classNode', position: { x: 0, y: 0 }, data: { className: nombre, attributes: [], methods: [] } });

test('3) deshacer el alta de una clase no borra la relación que otro le conectó después', () => {
  const b = clase('B'); const a = clase('A');
  const antes = { nodes: [b], edges: [] };
  const despues = { nodes: [b, a], edges: [] };
  const actual = { nodes: [b, a], edges: [{ id: 'AB', source: 'A', target: 'B', data: { type: 'Association' } }] };
  const r = deshacerSelectivo(actual, antes, despues);
  assert.deepEqual(r.estado.nodes.map((n) => n.id).sort(), ['A', 'B'], 'A se conserva');
  assert.deepEqual(r.estado.edges.map((e) => e.id), ['AB'], 'la relación ajena sigue');
  assert.equal(r.omitidos, 1, 'se avisa el conflicto');
});

test('3b) deshacer el alta sigue funcionando si las relaciones de la clase son mías', () => {
  const b = clase('B'); const a = clase('A');
  const mia = { id: 'AB', source: 'A', target: 'B', data: {} };
  const r = deshacerSelectivo({ nodes: [b, a], edges: [mia] }, { nodes: [b], edges: [] }, { nodes: [b, a], edges: [mia] });
  assert.deepEqual(r.estado.nodes.map((n) => n.id), ['B']);
  assert.equal(r.estado.edges.length, 0);
  assert.equal(r.omitidos, 0);
});

test('4) las tandas se numeran por cliente y la numeración sigue después de recargar', () => {
  const s = new Sincronia();
  s.local([{ op: 'ponerNodo', nodo: clase('A') }]);
  const uno = s.siguiente();
  assert.match(uno.id, /^.+:1$/);
  s.local([{ op: 'ponerNodo', nodo: clase('B') }]);
  const guardado = s.serializar();
  const recargado = new Sincronia(guardado);
  recargado.local([{ op: 'ponerNodo', nodo: clase('C') }]);
  const ids = recargado.pendientes.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'sin ids repetidos');
  assert.ok(ids.every((id) => id.startsWith(`${guardado.clienteId}:`)));
  assert.deepEqual(ids.map((id) => Number(id.split(':').pop())), [1, 2, 3]);
});

test('7) más de 500 operaciones salen en varias tandas; nada se pierde', () => {
  const s = new Sincronia();
  s.local(Array.from({ length: 2001 }, (_, i) => ({ op: 'ponerNodo', nodo: clase(`N${i}`) })));
  assert.ok(s.pendientes.every((l) => l.ops.length <= MAX_POR_TANDA));
  assert.equal(s.pendientes.reduce((n, l) => n + l.ops.length, 0), 2001);
  let servidor = { nodes: [], edges: [] };
  for (let lote = s.siguiente(); lote; lote = s.siguiente()) {
    servidor = aplicarOps(servidor, lote.ops);
    s.confirmar(lote.id);
  }
  assert.equal(servidor.nodes.length, 2001);
  assert.equal(s.vista().nodes.length, 2001);
  assert.equal(s.hayPendientes(), false);
});

test('8) una respuesta tardía del historial no borra lo que llegó en vivo y actualiza lo viejo', () => {
  const previos = [{ id: 1, datos: { propuesta: { estado: 'pendiente' } } }, { id: 81, texto: 'en vivo' }];
  const respuesta = [{ id: 1, datos: { propuesta: { id: 7, estado: 'pendiente' } } }, { id: 80, texto: 'del historial' }];
  const r = fusionarPorId(previos, respuesta, new Set([81]));
  assert.deepEqual(r.map((m) => m.id), [1, 80, 81]);
  assert.equal(r[0].datos.propuesta.id, 7, 'la versión completa del servidor reemplaza la vieja');
  const descartando = fusionarPorId([{ id: 3 }, { id: 90 }], [{ id: 201 }], new Set([90]), { descartarPrevios: true });
  assert.deepEqual(descartando.map((m) => m.id), [90, 201], 'sin continuidad: queda solo lo nuevo y lo recibido en vivo');
});

class AlmacenEnMemoria {
  constructor(entradas = []) { this.datos = new Map(entradas); }
  get length() { return this.datos.size; }
  key(i) { return [...this.datos.keys()][i] ?? null; }
  getItem(k) { return this.datos.get(k) ?? null; }
  setItem(k, v) { this.datos.set(k, String(v)); }
  removeItem(k) { this.datos.delete(k); }
}

test('9) otra pestaña sin conexión usa la copia confirmada de una pestaña cerrada (y no la borra)', () => {
  const local = new AlmacenEnMemoria();
  const sesion = new AlmacenEnMemoria([['sesion.pestana', 'pestanaNueva']]);
  const previoLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previoSesion = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: sesion });
  try {
    local.setItem('tablero.local.1.pestanaCerrada', JSON.stringify({ confirmado: { nodes: [clase('A')], edges: [] }, pendientes: [], actualizado: Date.now() - 20000 }));
    const r = leerSincronia('1');
    assert.deepEqual(r.confirmado.nodes.map((n) => n.id), ['A'], 'muestra el diagrama confirmado');
    assert.equal(local.length, 1, 'leer no borra nada');
    assert.deepEqual(r.quitables, ['tablero.local.1.pestanaCerrada'], 'se podrá quitar después de guardar la propia');
  } finally {
    if (previoLocal) Object.defineProperty(globalThis, 'localStorage', previoLocal); else delete globalThis.localStorage;
    if (previoSesion) Object.defineProperty(globalThis, 'sessionStorage', previoSesion); else delete globalThis.sessionStorage;
  }
});

test('6) "Guardar" espera a que el servidor confirme todas las tandas antes de escribir', async () => {
  // El hook real en una VM con React, reloj y socket simulados
  const nodo = (nombre) => clase('A', nombre);
  let servidor = { nodes: [nodo('Inicial')], edges: [] };
  let persistido = null;
  const handlers = new Map(); const unaVez = new Map(); const temporizadores = new Map();
  const acksPendientes = [];
  let proximo = 0;
  const socket = {
    on(e, f) { handlers.set(e, f); }, once(e, f) { unaVez.set(e, f); }, off(e, f) { if (unaVez.get(e) === f) unaVez.delete(e); },
    removeAllListeners() {}, disconnect() {},
    emit(e, payload, ack) {
      if (e === 'unirseSala') return ack({ ok: true });
      if (e === 'operaciones') { servidor = aplicarOps(servidor, payload.lote.ops); acksPendientes.push(ack); return undefined; }
      if (e === 'guardarEstado') { persistido = structuredClone(servidor); const f = unaVez.get('estadoGuardado'); unaVez.delete('estadoGuardado'); f({ success: true }); }
      return undefined;
    },
  };
  const estados = []; const efectos = [];
  const contexto = {
    console, env: {}, Sincronia, conservarTransitorios, opsEntre, URLSearchParams,
    window: { location: { origin: 'http://prueba.invalid', search: '', pathname: '/board/1' }, history: { replaceState() {} }, addEventListener() {}, removeEventListener() {} },
    document: { cookie: '' }, localStorage: { getItem() { return null; } },
    leerSincronia() { return null; }, guardarSincronia() { return true; }, olvidarCopia() {},
    io() { return socket; }, applyNodeChanges: (c, n) => n, applyEdgeChanges: (c, e) => e,
    useState(inicial) { const i = estados.length; estados.push(inicial); return [inicial, (v) => { estados[i] = typeof v === 'function' ? v(estados[i]) : v; }]; },
    useRef(current) { return { current }; }, useCallback(f) { return f; }, useEffect(f) { efectos.push(f); },
    setTimeout(fn, ms) { const id = ++proximo; temporizadores.set(id, { fn, ms }); return id; }, clearTimeout(id) { temporizadores.delete(id); },
  };
  const codigo = readFileSync(new URL('../src/config/useSocketFlow.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export const useSocketFlow', 'const useSocketFlow')
    .replace('export default useSocketFlow;', 'globalThis.hook = useSocketFlow;')
    .replaceAll('import.meta.env', 'env');
  vm.createContext(contexto);
  vm.runInContext(codigo, contexto);
  const hook = contexto.hook('1', { id: 1, name: 'Prueba' });
  efectos.forEach((f) => f());
  handlers.get('connect')();
  handlers.get('estadoInicial')({ state: servidor, aplicados: [] });
  const correrEnvios = () => { for (const [id, t] of [...temporizadores]) if (t.ms === 50) { temporizadores.delete(id); t.fn(); } };

  hook.setNodes([nodo('Primera edición')]);
  correrEnvios(); // sale la tanda 1; su confirmación todavía no llegó
  hook.setNodes([nodo('Última edición visible')]); // la tanda 2 espera a la 1
  const guardado = hook.guardarEstado();
  assert.equal(persistido, null, 'no pide escribir con tandas sin confirmar');
  acksPendientes.shift()({ ok: true }); // confirma la 1
  correrEnvios(); // sale la 2
  acksPendientes.shift()({ ok: true }); // confirma la 2
  await new Promise((r) => setImmediate(r));
  const respuesta = await guardado;
  assert.equal(respuesta.success, true);
  assert.equal(persistido.nodes[0].data.className, 'Última edición visible', 'lo guardado es lo que se ve');
});
