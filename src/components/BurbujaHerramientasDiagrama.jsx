import { useState, useRef, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import domtoimage from 'dom-to-image-more';
import { mensajeDeError } from '../utils/mensajesError';

/**
 * Componente de burbuja FAB con herramientas del diagrama
 * - Mantiene todas las funciones originales.
 * - "Exportar IMG" captura el lienzo en el navegador: no necesita servidor ni internet
 *   y la imagen muestra el diagrama tal como se ve (relaciones, multiplicidades, notas).
 */
// Margen alrededor del diagrama: deja espacio a relaciones recursivas y etiquetas
const MARGEN_IMAGEN = 80;
const BurbujaHerramientasDiagrama = ({
  nodes,
  edges,
  setNodes,
  setEdges,
  selectedNodeIds = [],
  selectedEdgeIds = [],
  boardId,
  updateBoardData: updateBoardDataProp,
  userEmail = null,
  defaultOpen = false,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const panelRef = useRef(null);
  const fabRef = useRef(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target) &&
        fabRef.current &&
        !fabRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const noopUpdate = async (newNodes, newEdges) => {
    console.warn('updateBoardData not provided. Changes will be local only.');
  };
  const updateBoardData = (typeof updateBoardDataProp === 'function') ? updateBoardDataProp : noopUpdate;

  // ---- Herramientas existentes (se mantienen) ----
  const seleccionarTodo = () => { setIsOpen(false); };
  const deseleccionarTodo = () => { setIsOpen(false); };

  const eliminarSeleccionados = async () => {
    if (selectedNodeIds.length === 0 && selectedEdgeIds.length === 0) return;
    const newNodes = nodes.filter(node => !selectedNodeIds.includes(node.id));
    const newEdges = edges.filter(edge =>
      !selectedEdgeIds.includes(edge.id) &&
      !selectedNodeIds.includes(edge.source) &&
      !selectedNodeIds.includes(edge.target)
    );
    setNodes(newNodes);
    setEdges(newEdges);
    await updateBoardData(newNodes, newEdges);
    setIsOpen(false);
  };

  const duplicarSeleccionados = async () => {
    if (selectedNodeIds.length === 0) return;
    const nodesToDuplicate = nodes.filter(node => selectedNodeIds.includes(node.id));
    const edgesToDuplicate = edges.filter(edge => selectedNodeIds.includes(edge.source) && selectedNodeIds.includes(edge.target));
    const duplicatedNodes = nodesToDuplicate.map((node) => ({
      ...node,
      id: `${node.id}_copy_${Date.now()}`,
      position: { x: node.position.x + 50, y: node.position.y + 50 },
      data: { ...node.data, name: `${node.data?.name || 'Nodo'}_Copia` }
    }));
    const idMap = {};
    nodesToDuplicate.forEach((n, i) => idMap[n.id] = duplicatedNodes[i].id);
    const duplicatedEdges = edgesToDuplicate.map(edge => ({
      ...edge,
      id: `${edge.id}_copy_${Date.now()}`,
      source: idMap[edge.source] || edge.source,
      target: idMap[edge.target] || edge.target
    }));
    const newNodes = [...nodes, ...duplicatedNodes];
    const newEdges = [...edges, ...duplicatedEdges];
    setNodes(newNodes); setEdges(newEdges);
    await updateBoardData(newNodes, newEdges);
    setIsOpen(false);
  };

  const limpiarDiagrama = async () => {
    if (nodes.length === 0 && edges.length === 0) return;
    const localCreatedCount = edges.filter(e => e?.data?._localCreated).length;
    let msg = '¿Estás seguro de que quieres limpiar todo el diagrama?';
    if (localCreatedCount > 0) msg += `\n\nNota: hay ${localCreatedCount} aristas no confirmadas localmente.`;
    if (window.confirm(msg)) {
      setNodes([]); setEdges([]);
      await updateBoardData([], []);
      setIsOpen(false);
    }
  };

  const autoOrganizar = () => {
    const organizedNodes = nodes.map((node, index) => ({
      ...node,
      position: { x: (index % 3) * 200 + 100, y: Math.floor(index / 3) * 150 + 100 }
    }));
    setNodes(organizedNodes);
    updateBoardData(organizedNodes, edges);
    setIsOpen(false);
  };

  const exportarJSON = () => {
    const diagramData = { nodes, edges, exportedAt: new Date().toISOString(), boardId };
    const blob = new Blob([JSON.stringify(diagramData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `diagrama_${boardId || 'board'}_${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    setIsOpen(false);
  };

  // ------------------ Exportar IMG: captura del lienzo en el navegador ------------------
  const { getNodes, getInternalNode } = useReactFlow();

  /**
   * Límites del diagrama: posición según React Flow y tamaño real del nodo en el DOM
   * (offsetWidth/offsetHeight no dependen del zoom; los nodos guardados pueden no traer `measured`).
   */
  const limitesDiagrama = () => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    getNodes().forEach((nodo) => {
      const interno = getInternalNode(nodo.id);
      if (!interno) return;
      const { x, y } = interno.internals.positionAbsolute;
      const elemento = document.querySelector(`.react-flow__node[data-id="${CSS.escape(nodo.id)}"]`);
      const ancho = elemento?.offsetWidth || interno.measured?.width || 0;
      const alto = elemento?.offsetHeight || interno.measured?.height || 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + ancho);
      maxY = Math.max(maxY, y + alto);
    });
    return Number.isFinite(minX) ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null;
  };

  /** true si la imagen tiene algo dibujado (se revisa una versión reducida). */
  const tieneContenido = async (blob) => {
    const mapa = await createImageBitmap(blob);
    const lienzo = document.createElement('canvas');
    lienzo.width = 400;
    lienzo.height = Math.max(1, Math.round((mapa.height * lienzo.width) / mapa.width));
    const ctx = lienzo.getContext('2d');
    ctx.drawImage(mapa, 0, 0, lienzo.width, lienzo.height);
    const { data } = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) return true;
    }
    return false;
  };

  /** PNG de todo el diagrama (no solo la parte visible), sin puntos de conexión ni controles. */
  const capturarDiagrama = async () => {
    const viewport = document.querySelector('.react-flow__viewport');
    const limites = limitesDiagrama();
    if (!viewport || !limites) return null;
    // Tamaño real del diagrama (1 px por unidad del lienzo): ampliarlo con scale()
    // dejó la imagen en blanco en las pruebas.
    const opciones = {
      width: Math.ceil(limites.width + MARGEN_IMAGEN * 2),
      height: Math.ceil(limites.height + MARGEN_IMAGEN * 2),
      bgcolor: '#ffffff',
      // Copiar todos los estilos calculados: comparar con los "por defecto" deja bordes grises
      // falsos por el reset de Tailwind (border-style sin border-width) y es mucho más lento
      copyDefaultStyles: false,
      style: {
        transform: `translate(${MARGEN_IMAGEN - limites.x}px, ${MARGEN_IMAGEN - limites.y}px) scale(1)`,
        transformOrigin: '0 0'
      },
      filter: (elemento) => !(elemento.classList && (
        elemento.classList.contains('react-flow__handle') ||
        elemento.classList.contains('react-flow__resize-control')
      )),
      // Cada relación es un <svg> sin tamaño propio: sin overflow visible la copia lo recorta a 300×150
      onclone: (copia) => {
        copia.querySelectorAll('svg').forEach((svg) => { svg.style.overflow = 'visible'; });
        return copia;
      }
    };
    // La primera captura de una página recién cargada sale en blanco y las siguientes no:
    // se comprueba que la imagen tenga contenido y, si no, se repite
    for (let intento = 0; intento < 3; intento++) {
      const blob = await domtoimage.toBlob(viewport, opciones);
      if (await tieneContenido(blob)) return blob;
    }
    throw new Error('la imagen salió en blanco');
  };

  const handleExportImgClick = async () => {
    setExporting(true);
    try {
      const blob = await capturarDiagrama();
      if (!blob) {
        alert('No hay diagrama para exportar.');
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diagrama_${boardId || 'board'}_${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('No se pudo exportar la imagen. ' + mensajeDeError(err, 'Intenta de nuevo.'));
    } finally {
      setExporting(false);
      setIsOpen(false);
    }
  };

  // ------------------ herramientas (incluye botón Exportar IMG wired to handler) ------------------
  const herramientas = [
    { id: 'select-all', label: 'Seleccionar Todo', icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>), action: seleccionarTodo, disabled: nodes.length === 0 },
    { id: 'deselect-all', label: 'Deseleccionar Todo', icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>), action: deseleccionarTodo, disabled: selectedNodeIds.length === 0 && selectedEdgeIds.length === 0 },
    { id: 'delete-selected', label: 'Eliminar Seleccionados', icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>), action: eliminarSeleccionados, disabled: selectedNodeIds.length === 0 && selectedEdgeIds.length === 0, danger: true },
    { id: 'duplicate-selected', label: 'Duplicar Seleccionados', icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>), action: duplicarSeleccionados, disabled: selectedNodeIds.length === 0 },
    { id: 'auto-organize', label: 'Auto Organizar', icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>), action: autoOrganizar, disabled: nodes.length === 0 },
    { id: 'export-json', label: 'Exportar JSON', icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>), action: exportarJSON, disabled: nodes.length === 0 && edges.length === 0 },
    { id: 'export-img', label: exporting ? 'Exportando...' : 'Exportar IMG', icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1z" /><circle cx="12" cy="13" r="3" strokeWidth="2" /></svg>), action: handleExportImgClick, disabled: nodes.length === 0 && edges.length === 0 || exporting },
    { id: 'clear-diagram', label: 'Limpiar Diagrama', icon: (<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>), action: limpiarDiagrama, disabled: nodes.length === 0 && edges.length === 0, danger: true }
  ];

  return (
    <div className={`fixed bottom-6 right-6 z-50 ${className}`}>
      {/* Panel de herramientas */}
      {isOpen && (
        <div 
          ref={panelRef}
          className="absolute bottom-16 right-0 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 min-w-56 max-w-xs animate-in fade-in zoom-in-95 duration-200"
        >
          {/* Header del panel */}
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Herramientas del Diagrama
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none"
              >
                ×
              </button>
            </div>
          </div>

          {/* Lista de herramientas */}
          <div className="py-2 max-h-80 overflow-y-auto">
            {herramientas.map((herramienta) => (
              <button
                key={herramienta.id}
                onClick={herramienta.action}
                disabled={herramienta.disabled}
                className={`
                  w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors
                  ${herramienta.disabled 
                    ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed' 
                    : herramienta.danger
                      ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }
                `}
              >
                <span className={`
                  ${herramienta.disabled 
                    ? 'opacity-50' 
                    : herramienta.danger 
                      ? 'text-red-500' 
                      : 'text-gray-500 dark:text-gray-400'
                  }
                `}>
                  {herramienta.icon}
                </span>
                {herramienta.label}
              </button>
            ))}
          </div>

          {/* Footer con estadísticas */}
          <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-xl">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{nodes.length} nodos</span>
              <span>{edges.length} conexiones</span>
              <span>{selectedNodeIds.length + selectedEdgeIds.length} seleccionados</span>
            </div>
          </div>
        </div>
      )}

      {/* Botón FAB */}
      <button
        ref={fabRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-14 h-14 bg-blue-600 dark:bg-blue-500 text-white rounded-full shadow-lg 
          hover:bg-blue-700 dark:hover:bg-blue-600 focus:outline-none focus:ring-4 
          focus:ring-blue-300 dark:focus:ring-blue-800 transition-all duration-200
          flex items-center justify-center group
          ${isOpen ? 'rotate-45' : 'hover:scale-110'}
        `}
        title="Herramientas del Diagrama"
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
          </svg>
        )}
      </button>
    </div>
  );
};

export default BurbujaHerramientasDiagrama;