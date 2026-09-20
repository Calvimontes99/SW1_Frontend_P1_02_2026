import { useState, useRef, useEffect } from 'react';
import { generateDiagram, modifyDiagram } from '../utils/aiService';
import PanelIALocal from './PanelIALocal';
import { iaNubeDisponible, resolverConIALocal, transcribirConIALocal } from '../ia-local/asistenteLocal.js';
import { EJEMPLOS_ORDENES } from '../ia-local/interpreteOrdenes.js';
import { mensajeDeError } from '../utils/mensajesError';

// Parse cardinality string and extract startLabel and endLabel
const parseCardinality = (cardinality) => {
  if (!cardinality || typeof cardinality !== 'string') {
    return { startLabel: null, endLabel: null };
  }

  // Handle common cardinality formats:
  // "1" -> both sides are "1"
  // "1:*" -> start="1", end="*"
  // "1..*" -> start="1", end="*"
  // "1..n" -> start="1", end="n"
  // "0..1:1..*" -> start="0..1", end="1..*"
  // "1 — *" -> start="1", end="*"

  let startLabel = null;
  let endLabel = null;

  // Clean the cardinality string
  const cleaned = cardinality.trim()
    .replace(/\s*—\s*|\s*-\s*|\s*to\s*/gi, ':')  // Replace dashes and "to" with colon
    .replace(/\s+/g, '');  // Remove spaces

  // Check for colon separator
  if (cleaned.includes(':')) {
    const parts = cleaned.split(':');
    startLabel = parts[0] || null;
    endLabel = parts[1] || null;
  } else {
    // Single cardinality value - apply to both sides
    startLabel = cleaned;
    endLabel = cleaned;
  }

  // Normalize common patterns
  const normalize = (label) => {
    if (!label) return null;
    
    // Convert patterns to standard notation
    label = label
      .replace(/\bn\b/gi, '*')  // n -> *
      .replace(/\.\.many/gi, '..*')  // ..many -> ..*
      .replace(/\.\.(\*|n)/gi, '..*')  // ..* or ..n -> ..*
      .replace(/^(\d+)\.\.(\*|\d+)$/gi, '$1..$2')  // Ensure proper format
      .replace(/^(\*|\d+)$/gi, '$1');  // Single values

    return label === '' ? null : label;
  };

  return {
    startLabel: normalize(startLabel),
    endLabel: normalize(endLabel)
  };
};

// Minimal AI Bubble component: floating FAB -> panel with input + history
export default function AiBubble({ boardId, nodes, edges, setNodes, setEdges, updateBoardData, onAiModificationChange }) {
  const [open, setOpen] = useState(false);
  // IA en uso: 'nube' (Gemini en el servidor) o 'local' (en este navegador, sin internet)
  const [motorIA, setMotorIA] = useState(null);
  const [panelLocal, setPanelLocal] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]); // {role: 'user'|'ai', text, diagram?}
  const fileRef = useRef(null);
  const imageInputRef = useRef(null);

  // mode: 'text' | 'voice' | 'image' | 'edit'
  const [mode, setMode] = useState('text');
  // Imágenes elegidas para enviar: se ven como miniaturas y se quitan una por una
  const [imagenes, setImagenes] = useState([]); // { id, file, url }
  const [zonaActiva, setZonaActiva] = useState(false);
  const [editedDiagram, setEditedDiagram] = useState(null);
  const [editWarnings, setEditWarnings] = useState([]);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const [, forceUpdate] = useState(0); // Para forzar re-render

  // Estados para manejo de clarificaciones en modificaciones
  const [pendingClarification, setPendingClarification] = useState(null);
  const [clarificationResponse, setClarificationResponse] = useState('');
  
  // Estado para controlar la pestaña desplegable de ejemplos
  const [showExamples, setShowExamples] = useState(false);
  
  // Flag para controlar sincronización durante modificaciones de IA
  const [aiModificationInProgress, setAiModificationInProgress] = useState(false);

  // Lista completa de ejemplos de comandos soportados
  const commandExamples = {
    "Gestión de Clases": [
      "añade clase Usuario con atributos nombre: string, email: string",
      "elimina la clase Cliente",
      "renombra la clase Producto a Item",
      "cambia el nombre de clase Order a Pedido"
    ],
    "Gestión de Atributos": [
      "añade atributo edad: int a la clase Usuario",
      "agrega atributo precio: decimal(10,2) a Producto", 
      "elimina el atributo telefono de Cliente",
      "borra atributo stock de la clase Producto",
      "actualiza el tipo del atributo nombre a string en Usuario"
    ],
    "Gestión de Métodos": [
      "añade método calcular(): float a la clase Factura",
      "agrega método obtenerTotal(): decimal a Pedido",
      "elimina el método setNombre de Usuario",
      "actualiza el método procesar en la clase Order"
    ],
    "Relaciones - Cambiar Tipo": [
      "modifica la relación entre Usuario y Pedido a composición",
      "cambia la relación entre Cliente y Factura a agregación",
      "convierte la asociación entre Orden y Item en herencia",
      "actualiza la relación de ClaseHija a ClasePadre como generalización",
      "cambia la relación A-B a implementación",
      "modifica la relación entre Servicio y Cliente a dependencia"
    ],
    "Relaciones - Cardinalidades": [
      "cambia la cardinalidad de Cliente a Pedido a 1:*",
      "actualiza la cardinalidad entre Producto y LineaPedido a 1:*", 
      "modifica la multiplicidad de Usuario-Rol a muchos a muchos (*:*)",
      "establece la cardinalidad Persona-Pasaporte como uno a uno (1:1)",
      "cambia la cardinalidad de Departamento a Empleado a 1..*"
    ],
    "Relaciones - Crear/Eliminar": [
      "añade relación de herencia de ClaseHija a ClasePadre",
      "crea composición entre Contenedor y Item con cardinalidad 1:*",
      "agrega asociación de Cliente a Pedido",
      "establece dependencia entre ClaseA y ClaseB",
      "elimina la relación entre ClaseX y ClaseY",
      "quita la herencia de SubClase a SuperClase"
    ],
    "Clases de Asociación": [
      "crea una clase de asociación entre Estudiante y Curso",
      "añade clase intermedia entre Cliente y Producto",
      "genera clase de asociación entre Usuario y Proyecto",
      "cambia la cardinalidad de Empleado a Departamento a muchos a muchos",
      "establece relación *:* entre Médico y Paciente",
      "crea nodo intermedio entre Persona y Empresa"
    ],
    "Operaciones Complejas": [
      "elimina clase Temporal y redirige sus relaciones a ClasePrincipal",
      "renombra Usuario a Cliente y añade atributo telefono: string",
      "crea clase Direccion con atributos calle, ciudad y relacióna con Usuario",
      "modifica Producto: añade atributo categoria y relación con Proveedor"
    ]
  };

  // Función para insertar un ejemplo en el textarea
  const insertExample = (example) => {
    setInput(example);
    setShowExamples(false);
  };

  // Initialize editedDiagram when entering 'edit' mode based on the last AI diagram message
  useEffect(() => {
    if (mode !== 'edit') return;
    const last = [...messages].reverse().find(m => m.role === 'ai' && m.diagram && Array.isArray(m.diagram.elements) && m.diagram.elements.length > 0);
    if (!last) {
      setEditedDiagram(null);
      return;
    }
    // Build copy
    const copy = {
      _sourceTs: Date.now(),
      nodes: (last.diagram.elements || []).map((el, i) => ({
        id: el.id || `ai_${i}_${Date.now()}`,
        name: el.name || el.title || `Class_${i+1}`,
        attributes: Array.isArray(el.attributes) ? el.attributes.slice() : (el.attributes ? [String(el.attributes)] : []),
        methods: Array.isArray(el.methods) ? el.methods.slice() : (el.methods ? [String(el.methods)] : [])
      })),
      edges: (last.diagram.relationships || []).map((r, i) => ({
        id: r.id || `ai_rel_${i}_${Date.now()}`,
        sourceId: r.sourceId || r.source || null,
        targetId: r.targetId || r.target || null,
        type: r.type || r.relation || 'Association'
      }))
    };
    setEditedDiagram(copy);
  }, [mode, messages]);



  // Helper to normalize attributes/methods to string array to avoid React rendering objects
  const normalizeStringArray = (maybeArr) => {
    if (!maybeArr) return [];
    if (!Array.isArray(maybeArr)) return [String(maybeArr)];
    return maybeArr.map(a => {
      if (a === null || a === undefined) return '';
      if (typeof a === 'string') return a;
      if (typeof a === 'object') {
        // prefer sensible fields
        const name = a.name || a.nombre || a.key || a.field || '';
        const type = a.type || a.tipo || a.datatype || '';
        if (name && type) return `${name}: ${type}`;
        if (name) return name;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }
      return String(a);
    }).filter(x => x !== '');
  };

  const toggle = () => setOpen(v => !v);

  const pushMessage = (m) => setMessages(prev => [...prev, m]);

  const agregarImagenes = (archivos) => {
    const nuevas = Array.from(archivos || [])
      .filter((f) => f && f.type && f.type.startsWith('image/'))
      .map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, url: URL.createObjectURL(file) }));
    if (nuevas.length) setImagenes((previas) => [...previas, ...nuevas]);
    return nuevas.length;
  };

  const quitarImagen = (id) => {
    setImagenes((previas) => {
      const fuera = previas.find((i) => i.id === id);
      // La miniatura se libera solo si no quedó en un mensaje ya enviado
      if (fuera && !fuera.enviada) URL.revokeObjectURL(fuera.url);
      return previas.filter((i) => i.id !== id);
    });
  };

  const quitarTodasLasImagenes = () => {
    setImagenes((previas) => {
      previas.forEach((i) => { if (!i.enviada) URL.revokeObjectURL(i.url); });
      return [];
    });
  };

  // Pegar una captura con Ctrl+V en cualquier parte del panel
  const alPegar = (evento) => {
    const archivos = Array.from(evento.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
    if (!archivos.length) return;
    evento.preventDefault();
    setMode('image');
    agregarImagenes(archivos);
  };

  const mergeDiagramIntoBoard = async (diagram) => {
    if (!diagram || (!diagram.elements && !diagram.relationships)) return;

    try {
      // Helpers: ensure attributes/methods are arrays of strings
      const ensureStringArray = (maybeArr) => {
        if (!maybeArr) return [];
        if (!Array.isArray(maybeArr)) return [String(maybeArr)];
        return maybeArr.map(a => {
          if (a === null || a === undefined) return '';
          if (typeof a === 'string') return a;
          // If attribute is an object like { name, type } -> format it
          if (typeof a === 'object') {
            try {
              const name = a.name || a.nombre || a.key || a.field || '';
              const type = a.type || a.tipo || a.datatype || '';
              if (name && type) return `${name}: ${type}`;
              if (name) return `${name}`;
              return JSON.stringify(a);
            } catch (e) {
              return JSON.stringify(a);
            }
          }
          return String(a);
        }).filter(x => x !== '');
      };

      const els = Array.isArray(diagram.elements) ? diagram.elements : [];
      const rels = Array.isArray(diagram.relationships) ? diagram.relationships : [];

      // Build a map name->id for elements that might reference by name
      const tempIdFor = (i) => `ai_${Date.now()}_${Math.random().toString(36).slice(2,8)}_${i}`;
      const created = [];
      const nameToId = new Map();

      const newNodes = els.map((el, i) => {
        const id = el && el.id ? String(el.id) : tempIdFor(i);
        const name = el && (el.name || el.nombre || el.title) ? String(el.name || el.nombre || el.title) : `Class_${i + 1}`;
        nameToId.set(name.toLowerCase(), id);
        created.push(id);
        return {
          id,
          type: 'classNode',
          position: (el && el.position) ? el.position : { x: Math.random() * 600 + 50, y: Math.random() * 400 + 50 },
          data: {
            className: name,
            attributes: ensureStringArray(el && el.attributes),
            methods: ensureStringArray(el && el.methods),
            _aiSource: true,
            // preserve raw metadata in case needed
            _raw: el
          }
        };
      });

      // Build edges, resolving source/target by id or by matching names to elements
      const newEdges = rels.map((rel, i) => {
        const id = rel && rel.id ? String(rel.id) : `ai_rel_${Date.now()}_${Math.random().toString(36).slice(2,8)}_${i}`;

        let source = rel && (rel.sourceId || rel.source) ? String(rel.sourceId || rel.source) : null;
        let target = rel && (rel.targetId || rel.target) ? String(rel.targetId || rel.target) : null;

        // If source/target look like names, try to resolve via nameToId
        if (source && !created.includes(source)) {
          const maybe = nameToId.get(String(source).toLowerCase());
          if (maybe) source = maybe;
        }
        if (target && !created.includes(target)) {
          const maybe = nameToId.get(String(target).toLowerCase());
          if (maybe) target = maybe;
        }

        // If still missing source/target, skip the edge (avoid invalid edge causing render errors)
        if (!source || !target) {
          return null;
        }

        // Procesar cardinalidad para extraer startLabel y endLabel
        const cardinality = rel && (rel.cardinality || rel.card) ? rel.cardinality || rel.card : null;
        const cardinalityData = parseCardinality(cardinality);

        return {
          id,
          source,
          target,
          type: 'umlEdge',
          data: {
            type: (rel && (rel.type || rel.relation)) || 'association',
            cardinality,
            startLabel: cardinalityData.startLabel,
            endLabel: cardinalityData.endLabel,
            _aiSource: true,
            _raw: rel
          }
        };
      }).filter(e => e !== null);

      // Avoid ID conflicts: if an AI-provided id already exists in board, rename the AI id
      const existingNodeIds = new Set((nodes || []).map(n => n && n.id));
      const remap = {};
      for (const n of newNodes) {
        if (existingNodeIds.has(n.id)) {
          const newId = `${n.id}_ai_${Date.now()}`;
          remap[n.id] = newId;
          n.id = newId;
        }
      }

      for (const e of newEdges) {
        if (remap[e.source]) e.source = remap[e.source];
        if (remap[e.target]) e.target = remap[e.target];
      }

      // Apply to state using functional updates and persist the explicit arrays to the server
      setNodes(prev => {
        try {
          const merged = [...(prev || []), ...newNodes];
          return merged;
        } catch (err) {
          console.error('AiBubble: setNodes merge failed', err);
          return prev || [];
        }
      });

      setEdges(prev => {
        try {
          const merged = [...(prev || []), ...newEdges];
          return merged;
        } catch (err) {
          console.error('AiBubble: setEdges merge failed', err);
          return prev || [];
        }
      });

      // Persist via updateBoardData if available (legacy-compatible: updateBoardData(nodesArray, edgesArray))
      try {
        if (typeof updateBoardData === 'function') {
          // Use freshest values by merging the passed-in props (nodes/edges) defensively
          const fullNodes = [...(Array.isArray(nodes) ? nodes : []), ...newNodes];
          const fullEdges = [...(Array.isArray(edges) ? edges : []), ...newEdges];
          await updateBoardData(fullNodes, fullEdges);
        }
      } catch (err) {
        console.warn('AiBubble: updateBoardData failed', err);
      }
    } catch (err) {
      console.error('AiBubble.mergeDiagramIntoBoard unexpected error', err);
      pushMessage({ role: 'ai', text: 'Hubo un error al integrar el diagrama generado. Revisa la consola para más detalles.' });
    }
  };

  const actualizarMotor = async () => setMotorIA((await iaNubeDisponible()) ? 'nube' : 'local');

  useEffect(() => {
    if (open) actualizarMotor();
  }, [open]);

  // Resuelve el pedido en este navegador: intérprete de órdenes o modelo de lenguaje local
  const ejecutarLocal = async (texto) => {
    setLoading(true);
    try {
      const r = await resolverConIALocal({ texto, nodes: nodes || [], edges: edges || [] });
      if (r.cambios > 0) {
        setNodes(r.nodes);
        setEdges(r.edges);
        if (typeof updateBoardData === 'function') await updateBoardData(r.nodes, r.edges);
      }
      const lineas = [];
      if (r.cambios > 0) {
        const comoLoHizo = r.motor === 'ollama'
          ? `Ollama en tu equipo · ${r.modeloUsado}`
          : (r.motor === 'modelo' ? 'modelo de lenguaje del navegador' : 'intérprete de órdenes');
        lineas.push(`💻 Hecho con la IA local (${comoLoHizo}):`);
        r.resumen.forEach((x) => lineas.push(`• ${x}`));
      }
      r.avisos.forEach((a) => lineas.push(`⚠️ ${a}`));
      const faltaModelo = r.noEntendidas.length > 0 && !r.modeloDisponible;
      if (r.noEntendidas.length) {
        lineas.push(`No entendí: ${r.noEntendidas.map((f) => `"${f}"`).join(', ')}.`);
        if (faltaModelo) {
          lineas.push(`Para pedidos libres descarga el modelo de lenguaje en "💻 Sin internet". Sin modelo entiendo órdenes como: ${EJEMPLOS_ORDENES.slice(0, 3).map((e) => `"${e}"`).join(', ')}.`);
        }
      }
      if (r.errorModelo) lineas.push(`(El modelo local falló: ${r.errorModelo})`);
      if (!lineas.length) lineas.push('No hubo cambios en el diagrama.');
      pushMessage({ role: 'ai', text: lineas.join('\n'), abrirPanel: faltaModelo });
    } catch (err) {
      console.error('IA local', err);
      pushMessage({ role: 'ai', text: `La IA local no pudo responder. ${mensajeDeError(err, 'Intenta de nuevo o recarga la página.')}` });
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (loading) return;
    if (mode === 'voice') return enviarVoz();
    if (mode === 'image') {
      if (await iaNubeDisponible()) return handleSendNube();
      pushMessage({ role: 'ai', text: 'El modo Imagen necesita la IA en la nube y ahora no hay conexión. Usa Texto, Voz o Editar.' });
      return;
    }
    const texto = input.trim();
    if (!texto) return;
    if (await iaNubeDisponible()) {
      setMotorIA('nube');
      return handleSendNube();
    }
    setMotorIA('local');
    pushMessage({ role: 'user', text: texto });
    setInput('');
    return ejecutarLocal(texto);
  };

  // La voz se transcribe siempre en el navegador con Whisper, también con internet
  const enviarVoz = async () => {
    if (!recordedChunksRef.current || recordedChunksRef.current.length === 0) return;
    const audio = new Blob(recordedChunksRef.current, { type: recordedChunksRef.current[0]?.type || 'audio/webm' });
    setLoading(true);
    let transcripcion;
    try {
      transcripcion = await transcribirConIALocal(audio);
    } catch (err) {
      pushMessage({ role: 'ai', text: `No se pudo transcribir el audio. ${mensajeDeError(err, 'Graba de nuevo hablando cerca del micrófono.')}` });
      setLoading(false);
      return;
    }
    if (transcripcion === null) {
      pushMessage({ role: 'ai', text: '🎙️ Para dictar, primero descarga el modelo de voz en "💻 Sin internet" (se descarga una sola vez).', abrirPanel: true });
      setLoading(false);
      return;
    }
    recordedChunksRef.current = [];
    forceUpdate(Date.now());
    setLoading(false);
    if (!transcripcion) {
      pushMessage({ role: 'ai', text: 'No se entendió el audio. Intenta de nuevo hablando más cerca del micrófono.' });
      return;
    }
    pushMessage({ role: 'user', text: `🎙️ ${transcripcion}` });
    if (await iaNubeDisponible()) {
      setMotorIA('nube');
      return handleSendNube(transcripcion, 'text');
    }
    setMotorIA('local');
    return ejecutarLocal(transcripcion);
  };

  // Envío de las imágenes seleccionadas: la IA analiza una por una y suma lo que encuentra
  const enviarImagenes = async (texto) => {
    const lote = imagenes;
    if (!lote.length || loading) return;
    setLoading(true);
    setMotorIA('nube');
    pushMessage({
      role: 'user',
      text: texto || (lote.length === 1 ? 'Analiza esta imagen' : `Analiza estas ${lote.length} imágenes`),
      imagenes: lote.map((i) => ({ url: i.url, nombre: i.file.name }))
    });
    setInput('');
    // Las miniaturas quedan en el historial del chat, así que no se liberan al vaciar la bandeja
    setImagenes((previas) => { previas.forEach((i) => { i.enviada = true; }); return []; });

    try {
      for (let i = 0; i < lote.length; i++) {
        if (lote.length > 1) pushMessage({ role: 'ai', text: `Analizando la imagen ${i + 1} de ${lote.length}…` });
        const res = await generateDiagram({ type: 'image', content: texto, file: lote[i].file, salaId: boardId });
        if (!res || !res.success) {
          pushMessage({ role: 'ai', text: mensajeDeError(new Error((res && res.error) || ''), 'La IA no pudo leer la imagen. Prueba con una foto más nítida.') });
          continue;
        }
        const diagrama = res.diagram || null;
        pushMessage({ role: 'ai', text: res.message || 'Diagrama generado', diagram: diagrama });
        if (diagrama) await mergeDiagramIntoBoard(diagrama);
      }
    } catch (err) {
      console.error('AiBubble enviarImagenes', err);
      pushMessage({ role: 'ai', text: mensajeDeError(err, 'No se pudo procesar la imagen. Intenta de nuevo.') });
    } finally {
      setLoading(false);
    }
  };

  // Envío a la IA en la nube (texto, edición o imagen)
  const modoUI = mode;
  const handleSendNube = async (textoForzado = null, modoForzado = null) => {
    const mode = modoForzado || modoUI;
    if (mode === 'text' && !(textoForzado ?? input)) return;
    if (mode === 'image') return enviarImagenes((textoForzado ?? input).trim());
    setLoading(true);
    const text = (textoForzado ?? input).trim();
    if (!textoForzado) pushMessage({ role: 'user', text });
    setInput('');

    try {
      let file = null;
      let type = 'text';
      if (mode === 'image') {
        file = fileRef.current && fileRef.current.files && fileRef.current.files[0] ? fileRef.current.files[0] : null;
        type = 'image';
      } else if (mode === 'voice') {
        // If there's a recording available in recordedChunksRef, send it
        if (recordedChunksRef.current && recordedChunksRef.current.length > 0) {
          const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
          file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
          // clear recorded chunks after attaching
          recordedChunksRef.current = [];
        }
        type = 'voice';
      }

      // Determine if this should be a modification or generation
      const modificationKeywords = [
        'modifica', 'cambiar', 'cambio', 'editar', 'edita', 'actualizar', 
        'actualiza', 'modificar', 'alterar', 'corregir', 'corrige', 'ajustar',
        'ajusta', 'reemplazar', 'reemplaza', 'sustituir', 'sustituye', 
        'elimina', 'eliminar', 'borrar', 'borra', 'quitar', 'quita', 'remover', 'remeve',
        'clase de asociacion', 'clase de asociación', 'clase intermedia', 'nodo intermedio',
        'muchos a muchos', 'many to many'
      ];
      
      const isModification = mode === 'edit' || 
                           (nodes && nodes.length > 0) && 
                           modificationKeywords.some(keyword => 
                             text.toLowerCase().includes(keyword)
                           );

      let res;
      if (isModification) {
        // Use modify diagram for edits

        
        res = await modifyDiagram({ 
          nodes: nodes || [], 
          edges: edges || [], 
          prompt: text,
          mode: 'modify',
          salaId: boardId
        });
      } else {
        // Use generate diagram for new creations
        res = await generateDiagram({ type, content: text, file, salaId: boardId });
      }

      if (!res || !res.success) {
        const errMsg = mensajeDeError(new Error((res && res.error) || ''), 'La IA no pudo procesar el pedido.');
        setLoading(false);
        if (mode === 'image' || !text) {
          pushMessage({ role: 'ai', text: errMsg });
          return;
        }
        // La nube falló (cuota, clave, servidor): se resuelve con la IA local
        pushMessage({ role: 'ai', text: `La IA en la nube no respondió (${errMsg}). Lo resuelvo con la IA local…` });
        await ejecutarLocal(text);
        return;
      }

      // Handle different response formats
      let diagramData = null;
      
      if (isModification && res.newState) {
        // modifyDiagram returns newState with nodes and edges
        // For modifications, we need to replace the entire board state, not merge
        // Set flag to prevent WebSocket conflicts during AI modifications
        setAiModificationInProgress(true);
        if (onAiModificationChange) onAiModificationChange(true);
        
        // Apply changes to local state immediately with protection
        const newNodes = res.newState.nodes || [];
        const newEdges = res.newState.edges || [];
        
        // Apply changes multiple times to ensure they stick
        const applyChanges = () => {
          setNodes([...newNodes]);
          setEdges([...newEdges]);
        };
        
        // Apply immediately
        applyChanges();
        
        // Apply again after short delay to override any WebSocket interference
        setTimeout(applyChanges, 50);
        setTimeout(applyChanges, 200);
        
        // Sync with server after local changes are established
        setTimeout(() => {
          if (updateBoardData && boardId) {
            updateBoardData({
              nodes: newNodes,
              edges: newEdges
            });
          }
          
          // Clear protection flag after sync
          setTimeout(() => {
            setAiModificationInProgress(false);
            if (onAiModificationChange) onAiModificationChange(false);
          }, 100);
        }, 800); // Longer delay to ensure local state is solid
        
        // Skip the mergeDiagramIntoBoard process for modifications
        const defaultMessage = 'Diagrama modificado correctamente';
        pushMessage({ role: 'ai', text: res.message || defaultMessage });
        setLoading(false);
        if (fileRef.current) fileRef.current.value = '';
        return;
      } else if (res.diagram) {
        // generateDiagram returns diagram property
        diagramData = res.diagram;
        
        // Handle clarifying questions for generation
        if (Array.isArray(diagramData.clarifyingQuestions) && diagramData.clarifyingQuestions.length > 0 && (!diagramData.elements || diagramData.elements.length === 0)) {
          const qText = diagramData.clarifyingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n');
          pushMessage({ role: 'ai', text: res.message || 'Se requieren aclaraciones:', questions: diagramData.clarifyingQuestions });
          pushMessage({ role: 'ai', text: qText });
          setLoading(false);
          return;
        }
      }

      const defaultMessage = isModification ? 'Diagrama modificado' : 'Diagrama generado';
      pushMessage({ role: 'ai', text: res.message || defaultMessage, diagram: diagramData });

      // Merge diagram into board
      if (diagramData) {
        await mergeDiagramIntoBoard(diagramData);
      }

    } catch (err) {
      console.error('AiBubble send error', err);
      if (mode === 'image' || !text) {
        pushMessage({ role: 'ai', text: mensajeDeError(err, 'La IA no pudo procesar el pedido. Intenta de nuevo.') });
      } else {
        pushMessage({ role: 'ai', text: `${mensajeDeError(err, 'La IA en la nube no respondió.')} Lo resuelvo con la IA local…` });
        setLoading(false);
        await ejecutarLocal(text);
      }
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // Recording handlers
  const startRecording = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      pushMessage({ role: 'ai', text: 'El navegador no soporta grabación de audio.' });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        setIsRecording(false);
        // stop all tracks
        stream.getTracks().forEach(t => t.stop());
      };

      mr.start();
      setIsRecording(true);
    } catch (err) {
      console.error('startRecording error', err);
      pushMessage({ role: 'ai', text: `No se pudo iniciar la grabación. ${mensajeDeError(err, 'Revisa que el micrófono esté conectado.')}` });
    }
  };

  const stopRecording = () => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    } catch (err) {
      console.warn('stopRecording', err);
    }
  };

  return (
    <div>
      {/* FAB */}
  <div className="fixed bottom-6 right-28 z-40">
        <button
          onClick={toggle}
          title="AI: Generar diagrama"
          className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg"
          aria-label="Abrir asistente IA"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="7" width="18" height="11" rx="2" stroke="currentColor" />
            <rect x="7" y="3" width="10" height="4" rx="1" stroke="currentColor" />
            <circle cx="9" cy="12" r="1.25" fill="white" />
            <circle cx="15" cy="12" r="1.25" fill="white" />
            <path d="M8 17h8" stroke="currentColor" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Panel */}
      {open && (
        <div onPaste={alPegar} className="fixed bottom-20 right-6 z-50 w-[90vw] max-w-md rounded-xl shadow-2xl overflow-hidden bg-white border border-gray-200" role="dialog" aria-label="AI Diagram Generator">
          {/* Backdrop para cerrar al hacer clic fuera */}
          <div 
            className="fixed inset-0 bg-black bg-opacity-20 z-40"
            onClick={toggle}
            aria-hidden="true"
          ></div>
          
          {/* Panel principal */}
          <div className="relative z-50 bg-white rounded-xl shadow-2xl max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="px-4 py-2 bg-gradient-to-r from-indigo-400 to-purple-600 text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/20 rounded flex items-center justify-center">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="7" width="18" height="11" rx="2" stroke="currentColor" />
                  <rect x="7" y="3" width="10" height="4" rx="1" stroke="currentColor" />
                  <circle cx="9" cy="12" r="1" fill="white" />
                  <circle cx="15" cy="12" r="1" fill="white" />
                  <path d="M8 17h8" stroke="currentColor" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-semibold">AI Diagram Generator</div>
                <div className="text-xs opacity-90">
                  {motorIA === 'local' ? '💻 IA local (sin internet)' : motorIA === 'nube' ? '☁️ IA en la nube' : 'Asistente de IA para crear diagramas'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                className={`h-7 px-2 rounded text-white text-xs flex items-center justify-center ${panelLocal ? 'bg-white/40' : 'bg-white/20'}`}
                onClick={() => setPanelLocal((v) => !v)}
                title="IA sin internet: descargar modelos y elegir nivel"
                aria-label="IA sin internet"
              >
                💻 Sin internet
              </button>
              <button className="w-7 h-7 rounded bg-white/20 text-white flex items-center justify-center" onClick={() => setOpen(false)} aria-label="Minimizar">—</button>
              <button className="w-7 h-7 rounded bg-white/20 text-white flex items-center justify-center" onClick={() => setOpen(false)} aria-label="Cerrar">✕</button>
            </div>
          </div>

          {panelLocal && (
            <div className="flex-1 overflow-y-auto bg-white">
              <PanelIALocal onCerrar={() => setPanelLocal(false)} onCambio={actualizarMotor} />
            </div>
          )}
          {/* Body - Scrollable content */}
          <div className={`flex-1 overflow-y-auto bg-white ${panelLocal ? 'hidden' : ''}`}>
            <div className="p-4 space-y-4">
            <div className="mb-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-700 border">
              <div className="mb-1">🎉 ¡Hola! Soy tu asistente de IA para crear diagramas de clases.</div>
              <div className="text-xs text-gray-500">Envía texto, una nota de voz o una imagen y generaré un diagrama UML automáticamente. Sin internet sigo funcionando con la IA local (texto, voz y edición).</div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => setMode('text')}
                className={`px-3 py-1 rounded-full text-sm ${mode === 'text' ? 'bg-indigo-200 text-indigo-900' : 'bg-gray-100 text-gray-600'}`}
                aria-pressed={mode === 'text'}
              >
                Texto
              </button>
              <button
                onClick={() => setMode('voice')}
                className={`px-3 py-1 rounded-full text-sm ${mode === 'voice' ? 'bg-purple-200 text-purple-900' : 'bg-gray-100 text-gray-600'}`}
                aria-pressed={mode === 'voice'}
              >
                Voz
              </button>
              <button
                onClick={() => setMode('image')}
                className={`px-3 py-1 rounded-full text-sm ${mode === 'image' ? 'bg-pink-200 text-pink-900' : 'bg-gray-100 text-gray-600'}`}
                aria-pressed={mode === 'image'}
              >
                Imagen
              </button>
              <button
                onClick={() => setMode('edit')}
                className={`px-3 py-1 rounded-full text-sm ${mode === 'edit' ? 'bg-green-200 text-green-900' : 'bg-gray-100 text-gray-600'}`}
                aria-pressed={mode === 'edit'}
                title="Editar diagrama"
              >
                Editar
              </button>
            </div>

            {/* Input area */}
            <div className="mb-3">
              {mode === 'text' && (
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Describe el diagrama que quieres"
                  className="w-full border rounded p-2 text-sm h-24"
                />
              )}

              {mode === 'voice' && (
                <div className="p-4 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-lg border border-purple-200">
                  <div className="text-center">
                    <div className="text-sm font-medium text-purple-700 mb-3">🎙️ Grabadora de Voz</div>
                    
                    {/* Indicador visual de grabación */}
                    {isRecording && (
                      <div className="mb-3">
                        <div className="flex justify-center items-center gap-2 mb-2">
                          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                          <span className="text-sm font-medium text-red-600">Grabando...</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div className="bg-red-500 h-1.5 rounded-full animate-pulse" style={{width: '100%'}}></div>
                        </div>
                      </div>
                    )}
                    
                    {/* Estado de grabación completada */}
                    {!isRecording && recordedChunksRef.current && recordedChunksRef.current.length > 0 && (
                      <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded-lg">
                        <div className="flex items-center justify-center gap-2 text-green-700">
                          <span className="text-lg">✅</span>
                          <span className="text-sm font-medium">Audio grabado - Listo para enviar</span>
                        </div>
                      </div>
                    )}
                    
                    {/* Botones de control */}
                    <div className="flex justify-center gap-3">
                      <button
                        onClick={() => { if (!isRecording) startRecording(); else stopRecording(); }}
                        disabled={loading}
                        className={`px-6 py-3 rounded-full font-medium transition-all duration-200 transform hover:scale-105 ${
                          isRecording 
                            ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-200' 
                            : 'bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-200'
                        } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {isRecording ? (
                          <span className="flex items-center gap-2">
                            <span className="w-2 h-2 bg-white rounded-full animate-pulse"></span>
                            Detener
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            🎤 Grabar
                          </span>
                        )}
                      </button>
                      
                      {/* Botón de limpiar grabación */}
                      {!isRecording && recordedChunksRef.current && recordedChunksRef.current.length > 0 && (
                        <button
                          onClick={() => {
                            recordedChunksRef.current = [];
                            forceUpdate(Date.now()); // Forzar re-render
                          }}
                          className="px-4 py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-full font-medium transition-all duration-200"
                        >
                          🗑️ Limpiar
                        </button>
                      )}
                    </div>
                    
                    {/* Instrucciones */}
                    <div className="mt-3 text-xs text-purple-600">
                      {isRecording 
                        ? 'Habla claramente y pulsa "Detener" cuando termines' 
                        : recordedChunksRef.current && recordedChunksRef.current.length > 0
                          ? 'Audio listo. Pulsa "Enviar" para generar el diagrama'
                          : 'Pulsa "Grabar" y describe el diagrama que quieres crear'
                      }
                    </div>
                  </div>
                </div>
              )}

              {mode === 'image' && (
                <div
                  onDragOver={(e) => { e.preventDefault(); setZonaActiva(true); }}
                  onDragLeave={() => setZonaActiva(false)}
                  onDrop={(e) => { e.preventDefault(); setZonaActiva(false); agregarImagenes(e.dataTransfer.files); }}
                  className={`rounded-lg border-2 border-dashed p-3 transition-colors ${zonaActiva ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50'}`}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { agregarImagenes(e.target.files); e.target.value = ''; }}
                  />

                  {imagenes.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {imagenes.map((img) => (
                        <div key={img.id} className="relative group">
                          <img
                            src={img.url}
                            alt={img.file.name}
                            title={img.file.name}
                            className="w-16 h-16 object-cover rounded-md border border-gray-300 shadow-sm"
                          />
                          <button
                            type="button"
                            onClick={() => quitarImagen(img.id)}
                            title={`Quitar ${img.file.name}`}
                            aria-label={`Quitar ${img.file.name}`}
                            className="absolute -top-1.5 -right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-gray-800 text-white text-xs shadow hover:bg-red-600"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => fileRef.current && fileRef.current.click()}
                      className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm"
                    >
                      {imagenes.length ? 'Agregar otra imagen' : 'Seleccionar imagen'}
                    </button>
                    {imagenes.length > 0 && (
                      <button
                        onClick={quitarTodasLasImagenes}
                        className="px-3 py-2 bg-white border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-100"
                      >
                        Quitar todas
                      </button>
                    )}
                    <div className="text-xs text-gray-500">
                      {imagenes.length === 0
                        ? 'Arrastra una imagen aquí, pégala con Ctrl+V o elige un archivo'
                        : `${imagenes.length} ${imagenes.length === 1 ? 'imagen lista' : 'imágenes listas'}: pulsa Enviar`}
                    </div>
                  </div>
                </div>
              )}

              {mode === 'edit' && (
                <div className="text-sm max-h-72 overflow-y-auto pr-2" style={{ maxHeight: '42vh' }}>
                  {/* Verificar si hay un diagrama existente para modificar */}
                  {(() => {
                    // Buscar el último diagrama generado por IA o usar el estado actual del board
                    const hasCurrentDiagram = nodes && nodes.length > 0;
                    const lastAiMessage = [...messages].reverse().find(m => m.role === 'ai' && m.diagram && (m.diagram.elements||[]).length > 0);
                    
                    if (!hasCurrentDiagram && !lastAiMessage) {
                      return (
                        <div className="p-3 bg-yellow-50 border rounded text-xs text-yellow-800">
                          No hay un diagrama disponible para modificar. Genera primero un diagrama o crea clases en el board.
                        </div>
                      );
                    }

                    return (
                      <div>
                        {/* Sistema de Modificación del Diagrama */}
                        <div className="mb-3 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded">
                          <div className="text-sm font-semibold text-indigo-800 mb-2">🔧 Modificación Inteligente del Diagrama</div>
                          <div className="text-xs text-indigo-600 mb-3">
                            Describe los cambios que quieres hacer. Ejemplos: "elimina la clase Cliente", "añade atributo nombre a Usuario"
                          </div>
                          
                          <textarea 
                            className="w-full border border-indigo-200 rounded p-3 text-sm h-24 mb-3 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400" 
                            placeholder="Describe la modificación que quieres realizar...&#10;• elimina la clase Cliente&#10;• añade atributo email tipo string a Usuario&#10;• crea relación entre Pedido y Cliente&#10;• actualiza el método calcular en Factura"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                          />
                          
                          {/* Pestaña desplegable de ejemplos */}
                          <div className="mb-3">
                            <button
                              type="button"
                              onClick={() => setShowExamples(!showExamples)}
                              className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 transition-colors"
                            >
                              <span className="flex items-center gap-2">
                                📚 Ejemplos de comandos soportados
                              </span>
                              <svg 
                                className={`w-4 h-4 transform transition-transform ${showExamples ? 'rotate-180' : ''}`} 
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            
                            {showExamples && (
                              <div className="mt-2 border border-indigo-200 rounded-md bg-white shadow-sm max-h-64 overflow-y-auto">
                                {Object.entries(commandExamples).map(([category, examples], categoryIndex) => (
                                  <div key={categoryIndex} className="border-b border-gray-100 last:border-b-0">
                                    <div className="px-3 py-2 bg-gray-50 text-xs font-semibold text-gray-700 border-b border-gray-200">
                                      {category}
                                    </div>
                                    <div className="divide-y divide-gray-100">
                                      {examples.map((example, exampleIndex) => (
                                        <button
                                          key={exampleIndex}
                                          type="button"
                                          onClick={() => insertExample(example)}
                                          className="w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-indigo-50 hover:text-indigo-800 transition-colors"
                                        >
                                          {example}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          
                          {/* Botón principal de modificación */}
                          <div className="flex gap-2 justify-end">
                            <button 
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-medium transition-colors" 
                              disabled={loading || !input.trim()} 
                              onClick={async () => {
                                const prompt = input.trim();
                                if (!prompt) {
                                  pushMessage({ role: 'ai', text: 'Por favor describe la modificación que quieres realizar.' });
                                  return;
                                }
                                
                                pushMessage({ role: 'user', text: prompt });
                                // Sin IA en la nube: se modifica con la IA local
                                if (!(await iaNubeDisponible())) {
                                  setMotorIA('local');
                                  setInput('');
                                  await ejecutarLocal(prompt);
                                  return;
                                }
                                setMotorIA('nube');
                                setLoading(true);
                                
                                try {
                                  // Preparar el estado actual del diagrama
                                  const currentNodes = (nodes || []).map(n => ({ 
                                    id: n.id, 
                                    data: {
                                      className: n.data?.className || 'Clase',
                                      attributes: n.data?.attributes || [],
                                      methods: n.data?.methods || []
                                    }
                                  }));
                                  
                                  const currentEdges = (edges || []).map(e => ({ 
                                    id: e.id, 
                                    source: e.source, 
                                    target: e.target, 
                                    data: { type: e.data?.type || 'Association' }
                                  }));
                                  
                                  // Llamar al servicio de modificación
                                  const response = await modifyDiagram({ 
                                    prompt, 
                                    nodes: currentNodes, 
                                    edges: currentEdges,
                                    mode: 'modify'
                                  });
                                  
                                  if (!response || !response.success) {
                                    const errorMsg = mensajeDeError(new Error(response?.error || ''), 'No se pudo aplicar la modificación. Intenta de nuevo o describe el cambio con otras palabras.');
                                    pushMessage({ role: 'ai', text: `❌ ${errorMsg}` });
                                    return;
                                  }
                                  
                                  // Verificar si la IA necesita aclaración
                                  if (response.needsClarification && response.clarifyingQuestions && response.clarifyingQuestions.length > 0) {
                                    // Mostrar las preguntas clarificadoras
                                    const questionsText = response.clarifyingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n');
                                    pushMessage({ 
                                      role: 'ai', 
                                      text: `🤔 Necesito más información:\n\n${questionsText}\n\nPor favor responde para continuar con la modificación.`,
                                      needsClarification: true,
                                      originalPrompt: prompt,
                                      clarifyingQuestions: response.clarifyingQuestions
                                    });
                                    setInput(''); // Limpiar para la respuesta
                                    return;
                                  }
                                  
                                  // Aplicar los cambios directamente al diagrama
                                  if (response.newState) {
                                    const { nodes: newNodes, edges: newEdges } = response.newState;
                                    
                                    // Convertir los nodos al formato de React Flow
                                    const updatedNodes = (newNodes || []).map((node, index) => ({
                                      id: node.id || `node_${Date.now()}_${index}`,
                                      type: 'classNode',
                                      position: node.position || { 
                                        x: Math.random() * 600 + 100, 
                                        y: Math.random() * 400 + 100 
                                      },
                                      data: {
                                        className: node.data?.className || node.name || 'Clase',
                                        attributes: normalizeStringArray(node.data?.attributes),
                                        methods: normalizeStringArray(node.data?.methods),
                                        _aiModified: true
                                      }
                                    }));
                                    
                                    // Convertir las edges al formato de React Flow
                                    const updatedEdges = (newEdges || []).map((edge, index) => ({
                                      id: edge.id || `edge_${Date.now()}_${index}`,
                                      source: edge.source,
                                      target: edge.target,
                                      type: 'umlEdge',
                                      data: {
                                        type: edge.data?.type || 'Association',
                                        cardinality: edge.data?.cardinality,
                                        startLabel: edge.data?.startLabel,
                                        endLabel: edge.data?.endLabel,
                                        _aiModified: true
                                      }
                                    }));
                                    
                                    // Actualizar el estado del diagrama
                                    setNodes(updatedNodes);
                                    setEdges(updatedEdges);
                                    
                                    // Persistir los cambios
                                    if (typeof updateBoardData === 'function') {
                                      await updateBoardData(updatedNodes, updatedEdges);
                                    }
                                    
                                    pushMessage({ 
                                      role: 'ai', 
                                      text: `✅ ${response.message || 'Diagrama modificado correctamente'}`,
                                      diagram: { elements: updatedNodes, relationships: updatedEdges }
                                    });
                                  } else {
                                    pushMessage({ role: 'ai', text: response.message || 'Modificación completada' });
                                  }
                                  
                                  setInput(''); // Limpiar el campo de entrada
                                  
                                } catch (err) {
                                  console.error('Error en modificación:', err);
                                  if (navigator.onLine !== false) {
                                    // La nube falló: se intenta con la IA local
                                    pushMessage({ role: 'ai', text: 'La IA en la nube no respondió. Lo intento con la IA local…' });
                                    setInput('');
                                    await ejecutarLocal(prompt);
                                    return;
                                  }
                                  pushMessage({ 
                                    role: 'ai', 
                                    text: `❌ No se pudo aplicar la modificación. ${mensajeDeError(err, 'Intenta de nuevo o describe el cambio con otras palabras.')}` 
                                  });
                                } finally {
                                  setLoading(false);
                                }
                              }}
                            >
                              {loading ? '🔄 Procesando...' : '🚀 Modificar Diagrama'}
                            </button>
                          </div>
                        </div>
                        
                        {/* Panel de Clarificaciones Interactivas */}
                        {(() => {
                          const lastMessage = messages[messages.length - 1];
                          if (lastMessage && lastMessage.needsClarification) {
                            return (
                              <div className="mb-3 p-3 bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded">
                                <div className="text-sm font-semibold text-amber-800 mb-2">🤔 Se necesita aclaración</div>
                                <div className="text-xs text-amber-700 mb-3 whitespace-pre-line">
                                  {lastMessage.clarifyingQuestions?.map((q, i) => (
                                    <div key={i} className="mb-1">• {q}</div>
                                  ))}
                                </div>
                                
                                <textarea 
                                  className="w-full border border-amber-200 rounded p-2 text-sm h-16 mb-2 focus:ring-2 focus:ring-amber-400 focus:border-amber-400" 
                                  placeholder="Responde a las preguntas para continuar con la modificación..."
                                  value={clarificationResponse}
                                  onChange={(e) => setClarificationResponse(e.target.value)}
                                />
                                
                                <div className="flex gap-2 justify-end">
                                  <button 
                                    className="px-3 py-1 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded text-sm" 
                                    onClick={() => {
                                      setPendingClarification(null);
                                      setClarificationResponse('');
                                      pushMessage({ role: 'ai', text: '❌ Modificación cancelada por el usuario.' });
                                    }}
                                  >
                                    Cancelar
                                  </button>
                                  <button 
                                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm" 
                                    disabled={loading || !clarificationResponse.trim()}
                                    onClick={async () => {
                                      if (!clarificationResponse.trim()) return;
                                      
                                      setLoading(true);
                                      pushMessage({ role: 'user', text: clarificationResponse });
                                      
                                      try {
                                        // Preparar el contexto completo para la clarificación
                                        const currentNodes = (nodes || []).map(n => ({ 
                                          id: n.id, 
                                          data: {
                                            className: n.data?.className || 'Clase',
                                            attributes: n.data?.attributes || [],
                                            methods: n.data?.methods || []
                                          }
                                        }));
                                        
                                        const currentEdges = (edges || []).map(e => ({ 
                                          id: e.id, 
                                          source: e.source, 
                                          target: e.target, 
                                          data: { type: e.data?.type || 'Association' }
                                        }));
                                        
                                        // Enviar prompt original + respuesta de clarificación
                                        const fullPrompt = `${lastMessage.originalPrompt}\n\nACLARACIÓN: ${clarificationResponse}`;
                                        
                                        const response = await modifyDiagram({ 
                                          prompt: fullPrompt,
                                          nodes: currentNodes, 
                                          edges: currentEdges,
                                          mode: 'modify',
                                          clarification: clarificationResponse,
                                          originalPrompt: lastMessage.originalPrompt
                                        });
                                        
                                        if (!response || !response.success) {
                                          const errorMsg = mensajeDeError(new Error(response?.error || ''), 'No se pudo aplicar la modificación. Intenta de nuevo o describe el cambio con otras palabras.');
                                          pushMessage({ role: 'ai', text: `❌ ${errorMsg}` });
                                          return;
                                        }
                                        
                                        // Aplicar los cambios
                                        if (response.newState) {
                                          const { nodes: newNodes, edges: newEdges } = response.newState;
                                          
                                          const updatedNodes = (newNodes || []).map((node, index) => ({
                                            id: node.id || `node_${Date.now()}_${index}`,
                                            type: 'classNode',
                                            position: node.position || { 
                                              x: Math.random() * 600 + 100, 
                                              y: Math.random() * 400 + 100 
                                            },
                                            data: {
                                              className: node.data?.className || node.name || 'Clase',
                                              attributes: normalizeStringArray(node.data?.attributes),
                                              methods: normalizeStringArray(node.data?.methods),
                                              _aiModified: true
                                            }
                                          }));
                                          
                                          const updatedEdges = (newEdges || []).map((edge, index) => ({
                                            id: edge.id || `edge_${Date.now()}_${index}`,
                                            source: edge.source,
                                            target: edge.target,
                                            type: 'umlEdge',
                                            data: {
                                              type: edge.data?.type || 'Association',
                                              cardinality: edge.data?.cardinality,
                                              startLabel: edge.data?.startLabel,
                                              endLabel: edge.data?.endLabel,
                                              _aiModified: true
                                            }
                                          }));
                                          
                                          setNodes(updatedNodes);
                                          setEdges(updatedEdges);
                                          
                                          if (typeof updateBoardData === 'function') {
                                            await updateBoardData(updatedNodes, updatedEdges);
                                          }
                                          
                                          pushMessage({ 
                                            role: 'ai', 
                                            text: `✅ ${response.message || 'Diagrama modificado correctamente con las aclaraciones proporcionadas'}`,
                                            diagram: { elements: updatedNodes, relationships: updatedEdges }
                                          });
                                        } else {
                                          pushMessage({ role: 'ai', text: response.message || 'Modificación completada con aclaraciones' });
                                        }
                                        
                                        // Limpiar estados de clarificación
                                        setPendingClarification(null);
                                        setClarificationResponse('');
                                        
                                      } catch (err) {
                                        console.error('Error en clarificación:', err);
                                        pushMessage({ 
                                          role: 'ai', 
                                          text: `❌ No se pudo procesar tu aclaración. ${mensajeDeError(err, 'Intenta de nuevo.')}` 
                                        });
                                      } finally {
                                        setLoading(false);
                                      }
                                    }}
                                  >
                                    {loading ? '🔄 Aplicando...' : '✅ Continuar'}
                                  </button>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        })()}
                        
                        {/* Información de estado del diagrama */}
                        <div className="mt-3 p-2 bg-gray-50 border rounded text-xs">
                          <div className="font-semibold text-gray-700 mb-1">📊 Estado actual del diagrama:</div>
                          <div className="text-gray-600">
                            • <strong>{(nodes || []).length}</strong> clases en el board
                            • <strong>{(edges || []).length}</strong> relaciones
                            • <strong>{messages.filter(m => m.role === 'ai' && m.diagram).length}</strong> diagramas generados por IA
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* Messages preview area - Mejorado con scroll y contenido responsivo */}
            <div className="relative">
              <div className="max-h-40 overflow-y-auto border bg-white rounded-lg shadow-sm scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
                <div className="p-3 space-y-3">
                  {messages.length === 0 && (
                    <div className="text-center py-4">
                      <div className="text-gray-400 text-sm mb-2">📝 Historial de conversación</div>
                      <div className="text-xs text-gray-500">Envía texto, imagen o nota de voz para comenzar</div>
                    </div>
                  )}
                  
                  {messages.map((m, idx) => (
                    <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] break-words ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                        <div className={`inline-block p-3 rounded-lg shadow-sm border ${
                          m.role === 'user' 
                            ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white border-indigo-200' 
                            : 'bg-gradient-to-br from-gray-50 to-gray-100 text-gray-800 border-gray-200'
                        }`}>
                          {/* Indicador de rol */}
                          <div className={`text-xs font-medium mb-1 ${
                            m.role === 'user' ? 'text-indigo-100' : 'text-gray-500'
                          }`}>
                            {m.role === 'user' ? '👤 Tú' : '🤖 IA Assistant'}
                          </div>
                          
                          {/* Contenido del mensaje con scroll horizontal si es necesario */}
                          {Array.isArray(m.imagenes) && m.imagenes.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2 justify-end">
                              {m.imagenes.map((img, i) => (
                                <img
                                  key={i}
                                  src={img.url}
                                  alt={img.nombre || `imagen ${i + 1}`}
                                  title={img.nombre || ''}
                                  className="w-12 h-12 object-cover rounded border border-white/60"
                                />
                              ))}
                            </div>
                          )}
                          <div className={`text-sm leading-relaxed whitespace-pre-line ${
                            m.text && m.text.length > 100 ? 'max-h-20 overflow-y-auto scrollbar-thin' : ''
                          }`}>
                            {m.text}
                            {m.abrirPanel && (
                              <button type="button" onClick={() => setPanelLocal(true)} className="mt-2 block text-xs font-semibold text-indigo-700 underline">
                                Abrir “IA sin internet”
                              </button>
                            )}
                          </div>
                          
                          {/* Preguntas de clarificación */}
                          {m.questions && Array.isArray(m.questions) && (
                            <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                              <div className="font-medium text-yellow-800 mb-1">❓ Necesito aclarar:</div>
                              <ul className="space-y-1">
                                {m.questions.map((q, qIdx) => (
                                  <li key={qIdx} className="text-yellow-700">• {q}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {/* Indicador de diagrama */}
                          {m.diagram && (
                            <div className="mt-2 flex items-center gap-2 text-xs">
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full border border-green-200">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                                Diagrama generado
                              </span>
                              <span className="text-green-600">
                                {(m.diagram.elements || []).length} clases
                              </span>
                            </div>
                          )}
                          
                          {/* Timestamp */}
                          <div className={`text-xs mt-2 ${
                            m.role === 'user' ? 'text-indigo-200' : 'text-gray-400'
                          }`}>
                            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Indicador de carga */}
                {loading && (
                  <div className="flex justify-start p-3 border-t">
                    <div className="max-w-[85%]">
                      <div className="bg-gray-100 border border-gray-200 rounded-lg p-3 shadow-sm">
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                          </div>
                          <span>IA está generando...</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Gradiente de scroll para indicar más contenido */}
              {messages.length > 3 && (
                <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-white to-transparent pointer-events-none rounded-b-lg"></div>
              )}
            </div>
            </div> {/* Cierre del contenido del cuerpo */}
          </div> {/* Cierre del área de scroll del cuerpo */}

          {/* Footer */}
          <div className="px-3 py-2 bg-gradient-to-r from-indigo-400 to-purple-600 flex items-center gap-2">
            <div className="flex-1">
              <div className="text-white text-sm">
                {mode === 'text' ? 'Texto' : 
                 mode === 'voice' ? 'Nota de voz' : 
                 mode === 'image' ? 'Imagen' : 
                 mode === 'edit' ? 'Modificar Diagrama' : 
                 'IA Assistant'}
              </div>
            </div>
            <div>
              <button onClick={handleSend} disabled={loading} className="bg-white text-indigo-700 px-3 py-1 rounded-full">
                {loading ? 'Generando…' : 'Enviar'}
              </button>
            </div>
          </div>
          {/* Cierre del panel principal */}
          </div>
        {/* Cierre del contenedor del panel */}
        </div>
      )}
    </div>
  );
}
