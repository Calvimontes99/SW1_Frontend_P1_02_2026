// El hook real useSocketFlow en una VM, con React, reloj y socket simulados (sin red ni navegador).
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Sincronia, conservarTransitorios } from '../src/utils/sincronia.js';
import { aplicarOps, opsEntre } from '../src/utils/operacionesDiagrama.js';

export const montarSocketFlow = ({ inicial = { nodes: [], edges: [] }, guardado = null } = {}) => {
  let servidor = structuredClone(inicial);
  let persistido = null;
  let local = null;
  const handlers = new Map(); const unaVez = new Map(); const temporizadores = new Map();
  const lotes = [];
  let proximo = 0;
  const socket = {
    on(e, f) { handlers.set(e, f); }, once(e, f) { unaVez.set(e, f); }, off(e, f) { if (unaVez.get(e) === f) unaVez.delete(e); },
    removeAllListeners() {}, disconnect() {},
    emit(e, payload, ack) {
      if (e === 'unirseSala') return ack({ ok: true });
      if (e === 'operaciones') { servidor = aplicarOps(servidor, payload.lote.ops); lotes.push({ lote: structuredClone(payload.lote), ack }); return undefined; }
      if (e === 'guardarEstado') { persistido = structuredClone(servidor); const f = unaVez.get('estadoGuardado'); unaVez.delete('estadoGuardado'); f({ success: true }); }
      return undefined;
    },
  };
  const estados = []; const efectos = [];
  const contexto = {
    console, env: {}, Sincronia, conservarTransitorios, opsEntre, URLSearchParams,
    window: { location: { origin: 'http://prueba.invalid', search: '', pathname: '/board/1' }, history: { replaceState() {} }, addEventListener() {}, removeEventListener() {} },
    document: { cookie: '' }, localStorage: { getItem() { return null; } },
    leerSincronia() { return guardado; }, guardarSincronia(_, x) { local = structuredClone(x); return true; }, olvidarCopia() {},
    io() { return socket; }, applyNodeChanges: (c, n) => n, applyEdgeChanges: (c, e) => e,
    useState(valor) { const i = estados.length; estados.push(valor); return [valor, (v) => { estados[i] = typeof v === 'function' ? v(estados[i]) : v; }]; },
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
  const limpiezas = efectos.map((f) => f()).filter((f) => typeof f === 'function');
  handlers.get('connect')();
  handlers.get('estadoInicial')({ state: servidor, aplicados: [] });
  return {
    hook, handlers, lotes, limpiezas,
    get servidor() { return servidor; }, get persistido() { return persistido; }, get local() { return local; },
    /** Corre los temporizadores de esa duración (50 ms: envío de tandas; 8000: límite de "Guardar"). */
    correr(ms) { for (const [id, t] of [...temporizadores]) if (t.ms === ms) { temporizadores.delete(id); t.fn(); } },
  };
};

export default montarSocketFlow;
