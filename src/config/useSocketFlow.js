import { useState, useCallback, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import { guardarSincronia, leerSincronia, olvidarCopia } from '../offline/almacenTableros.js';
import { opsEntre } from '../utils/operacionesDiagrama.js';
import { Sincronia, conservarTransitorios } from '../utils/sincronia.js';

/**
 * useSocketFlow: el tablero sincronizado en tiempo real con Socket.IO.
 *
 * - Lo que se ve es siempre "lo confirmado por el servidor" + "tandas propias sin confirmar"
 *   (utils/sincronia.js). Después de cada cosa que llega del servidor se reconstruye, así dos
 *   personas que editan lo mismo terminan viendo lo mismo (manda el orden del servidor).
 * - Los cambios del usuario entran SOLO por setNodes/setEdges (y onNodesChange/onEdgesChange, que
 *   los usan): ahí se calculan las operaciones contra la vista actual. Lo que llega del servidor
 *   o de la copia guardada reemplaza la vista sin generar operaciones; antes, abrir un tablero con
 *   una copia vieja se tomaba como una edición y pisaba la versión del servidor.
 * - Cada tanda tiene id y se guarda en el navegador hasta que el servidor la confirma; al recargar
 *   o reconectar se reenvía y el servidor descarta las que ya había aplicado.
 */
export const useSocketFlow = (boardId, currentUser = null, options = {}) => {
  // Marca que el siguiente cambio de estado viene de otro participante (o de la carga inicial):
  // el historial de deshacer lo salta para no revertir el trabajo de los demás.
  const cambioRemotoPendienteRef = useRef(false);
  const relojRemotoRef = useRef(null);
  const marcarCambioRemoto = () => {
    cambioRemotoPendienteRef.current = true;
    clearTimeout(relojRemotoRef.current);
    relojRemotoRef.current = setTimeout(() => { cambioRemotoPendienteRef.current = false; }, 1500);
  };
  /** true si el cambio actual venía de fuera; al consultarlo, la marca se consume. */
  const consumirCambioRemoto = useCallback(() => {
    const habia = cambioRemotoPendienteRef.current;
    cambioRemotoPendienteRef.current = false;
    return habia;
  }, []);

  const [nodes, setNodesVista] = useState([]);
  const [edges, setEdgesVista] = useState([]);
  const [participantes] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [editingData, setEditingData] = useState(null);
  const [editingEdge, setEditingEdge] = useState(null);
  const socketRef = useRef(null);
  const joinedRef = useRef(false);
  const boardRef = useRef(boardId);
  const lastEventsRef = useRef([]);
  // Conexión con el servidor (optimista al inicio para no mostrar el aviso al cargar)
  const [conectado, setConectado] = useState(true);
  // Socket ya unido a la sala (null mientras conecta): lo usan el chat y la IA compartida
  const [socketUnido, setSocketUnido] = useState(null);
  // Motivo por el que el servidor no dejó entrar (sin invitación, tablero inexistente, expulsado...)
  const [errorAcceso, setErrorAcceso] = useState(null);

  const syncRef = useRef(new Sincronia());
  // Vista actual con lo que es solo de esta pantalla (medidas, selección): siempre la más nueva,
  // también entre renders, para que setNodes(prev => ...) parta de lo último
  const vistaRef = useRef({ nodes: [], edges: [] });
  const relojEnvioRef = useRef(null);
  const relojGuardadoRef = useRef(null);
  // Quienes esperan a que el servidor haya confirmado todas las tandas ("Guardar", exportar)
  const esperandoVaciarRef = useRef([]);
  /** Avisa a quienes esperan: true si ya no queda nada pendiente; con `resultado` se corta la espera. */
  const avisarEspera = (resultado = null) => {
    if (resultado === null && syncRef.current.hayPendientes()) return;
    esperandoVaciarRef.current.splice(0).forEach((f) => f(resultado === null ? true : resultado));
  };
  // Cambios de una versión anterior que no se aplicaron por inciertos (se muestra un aviso)
  const [avisoSincronia, setAvisoSincronia] = useState(null);

  const pushDebugEvent = useCallback((name, payload) => {
    lastEventsRef.current.push({ name, payload, ts: Date.now() });
    if (lastEventsRef.current.length > 30) lastEventsRef.current.shift();
  }, []);

  const getUsuarioPayload = useCallback(() => ({
    id: currentUser?.id || currentUser?.uid || null,
    name: currentUser?.displayName || currentUser?.name || currentUser?.email || 'guest',
    email: currentUser?.email || null
  }), [currentUser]);

  const wsUrl = options.wsUrl || (import.meta.env.VITE_WS_URL ? import.meta.env.VITE_WS_URL : window.location.origin);

  useEffect(() => {
    boardRef.current = boardId;
  }, [boardId]);

  /** Copia en el navegador (lo confirmado + las tandas pendientes). `ya`: sin esperar. */
  const persistir = useCallback((ya = false) => {
    clearTimeout(relojGuardadoRef.current);
    const escribir = () => guardarSincronia(boardRef.current, syncRef.current.serializar());
    if (ya) return escribir();
    relojGuardadoRef.current = setTimeout(escribir, 300);
    return true;
  }, []);

  /** Muestra lo que dice el núcleo (servidor + pendientes). No genera operaciones. */
  const mostrarSincronia = useCallback(() => {
    const anterior = vistaRef.current;
    const nueva = syncRef.current.vista();
    if (!opsEntre(anterior, nueva).length) return; // nada visible cambió
    const vista = { nodes: conservarTransitorios(anterior.nodes, nueva.nodes), edges: conservarTransitorios(anterior.edges, nueva.edges) };
    marcarCambioRemoto();
    vistaRef.current = vista;
    setNodesVista(vista.nodes);
    setEdgesVista(vista.edges);
  }, []);

  /** Envía las tandas pendientes, una a la vez y en orden. */
  const enviarRef = useRef(() => {});
  const programarEnvio = useCallback(() => {
    if (relojEnvioRef.current) return;
    relojEnvioRef.current = setTimeout(() => { relojEnvioRef.current = null; enviarRef.current(); }, 50);
  }, []);
  enviarRef.current = () => {
    const socket = socketRef.current;
    if (!socket || !joinedRef.current) return;
    const lote = syncRef.current.siguiente();
    if (!lote) return;
    pushDebugEvent('operaciones.enviar', { id: lote.id, cantidad: lote.ops.length });
    socket.emit('operaciones', { salaId: boardRef.current, lote }, (ack) => {
      if (ack && ack.ok) syncRef.current.confirmar(lote.id, { duplicado: !!ack.duplicado });
      else syncRef.current.rechazar(lote.id);
      if (ack?.sinAcceso) return;
      // Lo confirmado se guarda ya: una recarga no debe repetir una tanda que el servidor aplicó
      persistir(true);
      mostrarSincronia();
      avisarEspera();
      if (syncRef.current.hayPendientes()) {
        if (ack && ack.ok) programarEnvio();
        else setTimeout(programarEnvio, 2000); // error del servidor: reintenta un poco después
      }
    });
  };

  /** Cambio del usuario: se calcula la diferencia con la vista actual y sale como operaciones. */
  const cambiarLocal = useCallback((nueva) => {
    const ops = opsEntre(vistaRef.current, nueva);
    vistaRef.current = nueva;
    setNodesVista(nueva.nodes);
    setEdgesVista(nueva.edges);
    if (!ops.length) return; // selección, medidas, arrastre sin mover: solo de esta pantalla
    pushDebugEvent('operaciones.locales', { cantidad: ops.length, tipos: [...new Set(ops.map(o => o.op))] });
    syncRef.current.local(ops);
    persistir();
    programarEnvio();
  }, [persistir, programarEnvio, pushDebugEvent]);

  // Mismas firmas que useState: los componentes los usan como siempre (valor o función)
  const setNodes = useCallback((valor) => {
    const actual = vistaRef.current;
    const nodos = typeof valor === 'function' ? valor(actual.nodes) : valor;
    cambiarLocal({ nodes: nodos || [], edges: actual.edges });
  }, [cambiarLocal]);
  const setEdges = useCallback((valor) => {
    const actual = vistaRef.current;
    const aristas = typeof valor === 'function' ? valor(actual.edges) : valor;
    cambiarLocal({ nodes: actual.nodes, edges: aristas || [] });
  }, [cambiarLocal]);

  useEffect(() => {
    if (!boardId) return;

    // El token va por cookie; si no hay (desarrollo o cross-origin), el guardado en localStorage
    let token = null;
    if (typeof document !== 'undefined') {
      const cookieMatch = document.cookie.match(/(^|;)\s*token=([^;]*)/);
      token = cookieMatch ? decodeURIComponent(cookieMatch.pop()) : null;
      if (!token && typeof localStorage !== 'undefined') token = localStorage.getItem('token') || null;
    }

    // Copia guardada: el tablero abre al instante y sin conexión. Se MUESTRA, no se toma como edición
    const guardado = leerSincronia(boardId);
    syncRef.current = new Sincronia(guardado || {});
    // Las copias de pestañas cerradas se quitan solo si la de esta pestaña quedó escrita
    if (guardado?.quitables?.length && persistir(true)) guardado.quitables.forEach(olvidarCopia);
    const inicial = syncRef.current.vista();
    vistaRef.current = inicial;
    marcarCambioRemoto();
    setNodesVista(inicial.nodes);
    setEdgesVista(inicial.edges);

    const socket = io(wsUrl, { withCredentials: true, auth: token ? { token } : {} });
    socketRef.current = socket;

    socket.on('connect', () => {
      const payloadUsuario = getUsuarioPayload();
      // Invitación del enlace o del QR (?invitacion=...): solo hace falta la primera vez
      let invitacion = null;
      try { invitacion = new URLSearchParams(window.location.search).get('invitacion'); } catch { /* noop */ }
      // Se avisa qué tandas quedaron pendientes: el servidor responde cuáles ya tenía
      const lotes = syncRef.current.pendientes.map((l) => l.id);
      socket.emit('unirseSala', { salaId: boardId, usuario: payloadUsuario, invitacion, lotes }, (ack) => {
        if (ack && ack.ok) {
          joinedRef.current = true;
          setConectado(true);
          setSocketUnido(socket);
          setErrorAcceso(null);
          if (invitacion) {
            try { window.history.replaceState(null, '', window.location.pathname); } catch { /* noop */ }
          }
          // Las pendientes se envían al recibir el estado del servidor
        } else {
          console.warn('useSocketFlow: unirseSala ack failed', ack);
          if (ack && ack.motivo && ack.motivo !== 'error') {
            setErrorAcceso(ack.mensaje || 'No tienes acceso a este tablero.');
            socket.disconnect();
          }
        }
      });
    });

    socket.on('disconnect', () => {
      joinedRef.current = false;
      setConectado(false);
      setSocketUnido(null);
      syncRef.current.desconectado();
    });
    socket.on('connect_error', () => setConectado(false));

    // Estado completo del servidor: base nueva; lo pendiente propio se aplica encima y se reenvía
    const alEstadoServidor = (estado, aplicados = []) => {
      syncRef.current.estadoServidor(estado || { nodes: [], edges: [] }, aplicados);
      persistir(true);
      mostrarSincronia();
      programarEnvio();
      // Si el servidor ya tenía todo lo pendiente, "Guardar" puede seguir (no hay más confirmaciones)
      avisarEspera();
      const descartadas = syncRef.current.descartadasLegado;
      if (descartadas > 0) {
        syncRef.current.descartadasLegado = 0;
        setAvisoSincronia(`${descartadas} cambio${descartadas === 1 ? '' : 's'} guardado${descartadas === 1 ? '' : 's'} sin conexión con la versión anterior de la app no se aplic${descartadas === 1 ? 'ó' : 'aron'}: el tablero cambió después y aplicarlo${descartadas === 1 ? '' : 's'} podía pisar trabajo más nuevo.`);
      }
    };
    socket.on('estadoInicial', (payload) => alEstadoServidor(payload?.state, payload?.aplicados || []));
    // El tablero cambió por fuera (importación, edición desde la lista, etc.)
    socket.on('xmlActualizado', (data) => { if (data?.nuevoEstado) alEstadoServidor(data.nuevoEstado); });
    socket.on('diagramaActualizado', (data) => { if (data?.data?.state) alEstadoServidor(data.data.state); });
    socket.on('operaciones', (payload) => {
      if (!payload || String(payload.salaId) !== String(boardRef.current)) return;
      syncRef.current.remotas(payload.ops);
      persistir();
      mostrarSincronia();
    });
    // Te quitaron del tablero o lo borraron: se corta todo
    socket.on('accesoRevocado', (payload) => {
      joinedRef.current = false;
      setSocketUnido(null);
      avisarEspera(false); // nada de lo pendiente se va a confirmar
      setErrorAcceso(payload?.mensaje || 'Ya no tienes acceso a este tablero.');
      socket.disconnect();
    });

    socket.on('usuariosConectados', (payload) => {
      const users = payload?.usuarios || [];
      setActiveUsers([...new Set(users.map(u => u.autorNombre || u.email || u.name || u.id))]);
    });
    socket.on('usuarioUnido', ({ usuario } = {}) => {
      if (!usuario) return;
      setActiveUsers(prev => {
        const label = usuario.autorNombre || usuario.email || usuario.name || usuario.id;
        return prev.includes(label) ? prev : [...prev, label];
      });
    });

    // Al cerrar o recargar la pestaña se guarda ya lo pendiente (el guardado normal espera 300 ms)
    const alSalir = () => persistir(true);
    window.addEventListener('pagehide', alSalir);

    return () => {
      window.removeEventListener('pagehide', alSalir);
      avisarEspera(false); // se cerró el tablero: "Guardar" no se queda esperando
      clearTimeout(relojEnvioRef.current);
      relojEnvioRef.current = null;
      persistir(true);
      joinedRef.current = false;
      setSocketUnido(null);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [boardId, wsUrl, currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Compatibilidad: los componentes que antes enviaban listas completas ya comparten con setNodes. */
  const updateBoardData = useCallback(async () => {
    programarEnvio();
  }, [programarEnvio]);

  /**
   * "Guardar" (y exportar, que lo usa): primero espera a que el servidor confirme TODAS las tandas
   * de lo que se ve; recién entonces le pide escribir. Antes podía confirmar el guardado con
   * cambios todavía en camino y la exportación tomaba la versión anterior.
   */
  const guardarEstado = useCallback(async (estado, opts = { timeoutMs: 8000 }) => {
    const socket = socketRef.current;
    if (!socket || !joinedRef.current) return { success: false, error: 'socket-not-ready' };
    const limite = opts.timeoutMs || 8000;
    const todoConfirmado = await new Promise((resolve) => {
      if (!syncRef.current.hayPendientes()) { resolve(true); return; }
      esperandoVaciarRef.current.push(resolve);
      programarEnvio();
      setTimeout(() => {
        esperandoVaciarRef.current = esperandoVaciarRef.current.filter((f) => f !== resolve);
        resolve(false);
      }, limite);
    });
    if (!todoConfirmado) return { success: false, error: 'Todavía hay cambios que el servidor no confirmó. Revisa tu conexión e intenta de nuevo.' };
    return new Promise((resolve) => {
      let resuelto = false;
      const alConfirmar = (ack) => { if (!resuelto) { resuelto = true; resolve(ack || { success: true }); } };
      socket.once('estadoGuardado', alConfirmar);
      socket.emit('guardarEstado', { salaId: boardRef.current });
      setTimeout(() => {
        if (resuelto) return;
        resuelto = true;
        socket.off('estadoGuardado', alConfirmar);
        resolve({ success: false, error: 'timeout' });
      }, limite);
    });
  }, [programarEnvio]);

  const onNodesChange = useCallback((changes) => {
    setNodes((prev) => applyNodeChanges(changes, prev));
  }, [setNodes]);

  const onEdgesChange = useCallback((changes) => {
    setEdges((prev) => applyEdgeChanges(changes, prev));
  }, [setEdges]);

  const addNode = useCallback(async (nodeType = 'classNode', customData = {}) => {
    let newNode;
    if (nodeType === 'noteNode') {
      newNode = {
        id: `note-${Date.now()}`,
        position: { x: Math.random() * 300 + 100, y: Math.random() * 300 + 100 },
        type: 'noteNode',
        data: { text: customData.text || 'Nueva nota...', isNote: true, ...customData }
      };
    } else {
      const sanitizedClassName = `Clase${vistaRef.current.nodes.filter(n => n.type === 'classNode').length + 1}`;
      newNode = {
        id: `node-${Date.now()}`,
        position: { x: Math.random() * 300 + 100, y: Math.random() * 300 + 100 },
        type: 'classNode',
        data: { className: sanitizedClassName, attributes: ['nuevoAtributo: string'], methods: ['nuevoMetodo(): void'], ...customData }
      };
    }
    setNodes(prev => [...prev, newNode]);
    return newNode;
  }, [setNodes]);

  const updateActiveUsers = useCallback(async () => {
    const socket = socketRef.current;
    if (socket && joinedRef.current) socket.emit('solicitarEstado', { salaId: boardRef.current });
  }, []);

  const cleanupActiveUser = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;
    persistir(true);
    joinedRef.current = false;
    socket.disconnect();
  }, [persistir]);

  // Edge/node selection helpers
  const handleNodeSelection = useCallback((node) => {
    setSelectedNode(node);
    setEditingData({ ...node.data });
  }, []);

  const handleEdgeSelection = useCallback((edge) => {
    setSelectedNode(null);
    setEditingData(null);
    setSelectedEdge(edge);
    const completeEdgeData = { type: 'Association', startLabel: '', endLabel: '', label: '', sourceRole: '', targetRole: '', selected: true, ...edge.data };
    setEditingEdge(completeEdgeData);
    // La marca de selección es solo de este usuario: no se comparte (operacionesDiagrama la quita)
    setEdges((prev) => prev.map(e => ({ ...e, data: { ...e.data, selected: e.id === edge.id } })));
  }, [setEdges]);

  const updateNodeData = useCallback(async () => {
    if (!selectedNode) return;
    const sanitizedClassName = editingData.className ? editingData.className.replace(/\s+/g, '_') : editingData.className;
    setNodes(prev => prev.map(node => (node.id === selectedNode.id ? { ...node, data: { ...editingData, className: sanitizedClassName } } : node)));
    setSelectedNode(null);
  }, [selectedNode, editingData, setNodes]);

  const updateEdgeData = useCallback(async () => {
    if (!selectedEdge || !editingEdge) return;
    const { selected, ...cleanEdgeData } = editingEdge;
    // Fusionar sobre el data ACTUAL del edge (no reemplazarlo): editingEdge es una copia
    // capturada al seleccionar y reemplazar borraba campos añadidos después
    setEdges(prev => prev.map(edge => (edge.id === selectedEdge.id
      ? { ...edge, data: { ...edge.data, ...cleanEdgeData, selected: false } }
      : { ...edge, data: { ...edge.data, selected: false } })));
    setSelectedEdge(null);
    setEditingEdge(null);
  }, [selectedEdge, editingEdge, setEdges]);

  return {
    nodes,
    edges,
    participantes,
    selectedNode,
    selectedEdge,
    editingData,
    editingEdge,
    onNodesChange,
    onEdgesChange,
    addNode,
    handleNodeSelection,
    handleEdgeSelection,
    updateNodeData,
    updateEdgeData,
    setEditingData,
    setEditingEdge,
    setSelectedEdge,
    updateBoardData,
    guardarEstado,
    consumirCambioRemoto,
    setNodes,
    setEdges,
    updateActiveUsers,
    cleanupActiveUser,
    getDebugEvents: () => lastEventsRef.current,
    activeUsers,
    conectado,
    socketUnido,
    errorAcceso,
    avisoSincronia,
    cerrarAvisoSincronia: () => setAvisoSincronia(null)
  };
};

export default useSocketFlow;
