import React, { memo, useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getBezierPath,
  Position,
  useReactFlow,
  useInternalNode,
  useStore,
} from '@xyflow/react';

// Función para calcular la posición de las etiquetas de cardinalidad según el handle
const getCardinalityPosition = (x, y, position, type) => {
  const offset = 30; // Distancia de separación de la etiqueta

  switch (position) {
    case Position.Top:
      return {
        x: x + (type === 'start' ? -15 : 15), // Offset horizontal para evitar superposición
        y: y - offset
      };
    case Position.Bottom:
      return {
        x: x + (type === 'start' ? -15 : 15), // Offset horizontal para evitar superposición
        y: y + offset
      };
    case Position.Left:
      return {
        x: x - offset,
        y: y + (type === 'start' ? -10 : 10) // Offset vertical para evitar superposición
      };
    case Position.Right:
    default:
      return {
        x: x + offset,
        y: y + (type === 'start' ? -10 : 10) // Offset vertical para evitar superposición
      };
  }
};

const UML_RELATIONSHIP_TYPES = {
  Association: {
    markerStart: 'none',
    markerEnd: 'none',
    strokeStyle: 'solid',
    stroke: '#000000'
  },
  Aggregation: {
    markerStart: 'none',
    markerEnd: 'diamond',
    strokeStyle: 'solid',
    stroke: '#1976d2'
  },
  Composition: {
    markerStart: 'none',
    markerEnd: 'diamond-filled',
    strokeStyle: 'solid',
    stroke: '#d32f2f'
  },
  Generalization: {
    markerStart: 'none',
    markerEnd: 'generalization',
    strokeStyle: 'solid',
    stroke: '#000000'
  },
  Implementation: {
    markerStart: 'none',
    markerEnd: 'generalization',
    strokeStyle: 'dashed',
    stroke: '#000000'
  },
  Dependency: {
    markerStart: 'none',
    markerEnd: 'arrow',
    strokeStyle: 'dashed',
    stroke: '#666666'
  },
  NoteConnection: {
    markerStart: 'none',
    markerEnd: 'none',
    strokeStyle: 'dashed',
    stroke: '#fbbf24' // Color amarillo para conexiones de notas
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Trazado de relaciones entre clases
//
// Las aristas importadas (EA, XMI, IA) no traen punto de conexión y React Flow
// las enganchaba todas al primer handle de cada clase: las líneas se enredaban y
// dos relaciones entre las mismas clases (p. ej. "origen" y "destino") quedaban
// exactamente superpuestas. Ahora:
//   - sin handle elegido, la línea sale del lado de cada clase que mira a la otra;
//   - varias relaciones entre el mismo par de clases se reparten en carriles
//     paralelos, con sus etiquetas y cardinalidades separadas.
// ─────────────────────────────────────────────────────────────────────────────

const HANDLES_DE_CLASE = new Set([
  'right-top', 'right-center', 'right-bottom',
  'left-top', 'left-center', 'left-bottom',
  'top-center', 'bottom-center',
]);

// Distancia entre carriles de relaciones paralelas
const SEPARACION_PARALELAS = 36;

const esRelacionNormal = (e) =>
  !e.data?.isAssociationConnection && !e.data?.isNoteConnection && e.source !== e.target;

/** "índice/total" de la arista entre las relaciones que unen el mismo par de nodos. */
const posicionEntreParalelas = (edges, id, source, target) => {
  let indice = 0;
  let total = 0;
  for (const e of edges) {
    if (!esRelacionNormal(e)) continue;
    const mismoPar =
      (e.source === source && e.target === target) || (e.source === target && e.target === source);
    if (!mismoPar) continue;
    if (e.id === id) indice = total;
    total += 1;
  }
  return `${indice}/${total}`;
};

const rectanguloDe = (nodo) => {
  const { x, y } = nodo.internals.positionAbsolute;
  const ancho = nodo.measured?.width ?? nodo.width ?? 0;
  const alto = nodo.measured?.height ?? nodo.height ?? 0;
  return { x, y, ancho, alto, cx: x + ancho / 2, cy: y + alto / 2 };
};

/** Lados enfrentados de dos clases: horizontal si las separa más espacio en X que en Y. */
const ladosEnfrentados = (a, b) => {
  const huecoX = Math.max(a.x - (b.x + b.ancho), b.x - (a.x + a.ancho));
  const huecoY = Math.max(a.y - (b.y + b.alto), b.y - (a.y + a.alto));
  if (huecoX >= huecoY) {
    return b.cx >= a.cx
      ? [Position.Right, Position.Left]
      : [Position.Left, Position.Right];
  }
  return b.cy >= a.cy
    ? [Position.Bottom, Position.Top]
    : [Position.Top, Position.Bottom];
};

/** Punto sobre un lado de la clase, desplazado a lo largo del lado sin salirse de él. */
const puntoEnLado = (r, lado, desplazamiento) => {
  const acotar = (largo) => Math.max(-(largo / 2 - 12), Math.min(largo / 2 - 12, desplazamiento));
  switch (lado) {
    case Position.Left: return { x: r.x, y: r.cy + acotar(r.alto) };
    case Position.Right: return { x: r.x + r.ancho, y: r.cy + acotar(r.alto) };
    case Position.Top: return { x: r.cx + acotar(r.ancho), y: r.y };
    default: return { x: r.cx + acotar(r.ancho), y: r.y + r.alto };
  }
};

const esLadoHorizontal = (lado) => lado === Position.Left || lado === Position.Right;

const UmlEdge = ({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  data,
  style = {}
}) => {
  // Acceso a React Flow para obtener nodos y edges actuales
  const { getNodes, getEdges } = useReactFlow();

  // Cajas de las dos clases y lugar de esta arista entre sus paralelas
  const nodoOrigen = useInternalNode(source);
  const nodoDestino = useInternalNode(target);
  const paralelas = useStore((s) => posicionEntreParalelas(s.edges, id, source, target));

  // Estado para forzar re-render de líneas punteadas
  const [forceRender, setForceRender] = useState(0);

  // Sistema de callback para forzar re-render cuando el edge padre cambia
  React.useEffect(() => {
    if (data?.isAssociationConnection && data?.parentRelationId) {
      const forceUpdate = (parentEdgeId) => {
        if (parentEdgeId === data.parentRelationId) {
          setForceRender(prev => prev + 1);

        }
      };

      window.__forceAssocLineUpdate = forceUpdate;

      return () => {
        if (window.__forceAssocLineUpdate === forceUpdate) {
          window.__forceAssocLineUpdate = null;
        }
      };
    }
  }, [data?.isAssociationConnection, data?.parentRelationId, id]);

  // Detectar si es una conexión recursiva (mismo nodo).
  // Preferir comparar los ids de nodo (source === target). Como fallback,
  // comparar coordenadas (por compatibilidad con versiones antiguas).
  const isRecursive = (typeof source !== 'undefined' && typeof target !== 'undefined')
    ? source === target
    : (sourceX === targetX && sourceY === targetY);

  // Usar puntos de control personalizados si están definidos en data
  const customControlPoints = data?.controlPoints || [];
  const hasCustomPath = customControlPoints.length > 0;

  // Ensure data is defined and get edge type flags early
  data = data || {};
  const isAssociationConnection = data?.isAssociationConnection || false;
  const isNoteConnection = data?.isNoteConnection || false;

  // Extremos con los que se traza una relación normal
  let sx = sourceX;
  let sy = sourceY;
  let tx = targetX;
  let ty = targetY;
  let sPos = sourcePosition;
  let tPos = targetPosition;
  let desplazamiento = 0;
  let enCarril = false;

  const esNormal = !isRecursive && !isAssociationConnection && !isNoteConnection && !data?.hasAssociationClass;
  if (esNormal) {
    const [indice, total] = paralelas.split('/').map(Number);
    enCarril = total > 1;
    desplazamiento = enCarril ? (indice - (total - 1) / 2) * SEPARACION_PARALELAS : 0;

    const conHandlesElegidos = HANDLES_DE_CLASE.has(sourceHandleId) && HANDLES_DE_CLASE.has(targetHandleId);
    const medidos = nodoOrigen?.measured?.width && nodoDestino?.measured?.width;

    if (!conHandlesElegidos && medidos) {
      const rOrigen = rectanguloDe(nodoOrigen);
      const rDestino = rectanguloDe(nodoDestino);
      [sPos, tPos] = ladosEnfrentados(rOrigen, rDestino);
      ({ x: sx, y: sy } = puntoEnLado(rOrigen, sPos, desplazamiento));
      ({ x: tx, y: ty } = puntoEnLado(rDestino, tPos, desplazamiento));
    } else if (desplazamiento) {
      // Handles elegidos por el usuario: se respetan y solo se separan los carriles
      const mover = (x, y, lado) =>
        esLadoHorizontal(lado) ? { x, y: y + desplazamiento } : { x: x + desplazamiento, y };
      ({ x: sx, y: sy } = mover(sx, sy, sPos));
      ({ x: tx, y: ty } = mover(tx, ty, tPos));
    }
  }

  let edgePath, labelX, labelY;

  // 🎯 MODIFICACIÓN PARA ASSOCIATION CLASS: Forzar path a través del punto AC
  if (data?.hasAssociationClass && !isAssociationConnection && !isNoteConnection) {
    // Para edges con clase de asociación, usar Bézier que pase por el punto AC
    const midX = (sourceX + targetX) / 2;
    const midY = (sourceY + targetY) / 2;

    // Crear Bézier path que pase por el punto medio (donde está el AC)
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
      curvature: 0.1 // Curvatura menor para que pase más cerca del AC
    });

    // Forzar que el label esté en el punto medio calculado
    labelX = midX;
    labelY = midY - 10; // Slightly above for better visibility


  } else if (hasCustomPath && !isRecursive) {
    // Usar Bézier path con puntos de control personalizados
    [edgePath, labelX, labelY] = getBezierPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: sPos,
      targetX: tx,
      targetY: ty,
      targetPosition: tPos,
      curvature: 0.25
    });
  } else {
    // Smooth step. Con relaciones paralelas, el tramo central también se desplaza
    // para que los carriles no se crucen ni se superpongan.
    const centro = !desplazamiento || isRecursive
      ? {}
      : esLadoHorizontal(sPos)
        ? { centerX: (sx + tx) / 2 + desplazamiento }
        : { centerY: (sy + ty) / 2 + desplazamiento };
    [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX: sx,
      sourceY: sy,
      sourcePosition: sPos,
      targetX: tx,
      targetY: ty,
      targetPosition: tPos,
      borderRadius: isRecursive ? 25 : 5,
      offset: isRecursive ? 50 : 20,
      ...centro
    });
  }

  if (!edgePath) return null;

  // 🔍 DEBUG TEMPORAL: Log de coordenadas del edge para debug de asociación
  if (data?.hasAssociationClass || data?.isAssociationConnection) {


    // 🎯 COMUNICAR COORDENADAS REALES AL BOARDPAGE Y A LÍNEAS PUNTEADAS
    if (data?.hasAssociationClass && window.__onAssocEdgeRender) {
      window.__onAssocEdgeRender({
        edgeId: id,
        realLabelX: labelX,
        realLabelY: labelY,
        sourceX,
        sourceY,
        targetX,
        targetY
      });
    }

    // 🔄 SISTEMA DE COORDENADAS COMPARTIDAS para líneas punteadas
    if (data?.hasAssociationClass) {
      if (!window.__acCoordinates) window.__acCoordinates = {};

      // Detectar si las coordenadas han cambiado
      const prevCoords = window.__acCoordinates[id];
      const coordsChanged = !prevCoords ||
        Math.abs(prevCoords.acX - labelX) > 0.1 ||
        Math.abs(prevCoords.acY - labelY) > 0.1;

      window.__acCoordinates[id] = {
        acX: labelX,
        acY: labelY,
        timestamp: Date.now(),
        version: (prevCoords?.version || 0) + (coordsChanged ? 1 : 0)
      };

      // Forzar invalidación de líneas punteadas cuando las coordenadas cambian
      if (coordsChanged && window.__forceAssocLineUpdate) {
        window.__forceAssocLineUpdate(id);
      }


    }
  }

  // Resolve relationship type case-insensitively and default to Association
  const requestedRel = data.type || data.relation || 'Association';
  let edgeType = UML_RELATIONSHIP_TYPES['Association'];
  try {
    const matchKey = Object.keys(UML_RELATIONSHIP_TYPES).find(k => k.toLowerCase() === String(requestedRel).toLowerCase());
    if (matchKey) edgeType = UML_RELATIONSHIP_TYPES[matchKey];
  } catch (e) {
    edgeType = UML_RELATIONSHIP_TYPES['Association'];
  }
  const isSelected = data?.selected || false;

  // Estilos especiales para conexiones de clase de asociación
  if (isAssociationConnection) {


    // Si tiene coordenadas AC target específicas, renderizar hacia esas coordenadas
    let finalPath = edgePath;
    let finalLabelX = labelX;
    let finalLabelY = labelY;

    // 🎯 COORDENADAS DINÁMICAS PRECISAS desde el edge original
    if (data?.parentRelationId) {
      // Obtener coordenadas exactas del edge original desde el sistema compartido
      // El forceRender garantiza que siempre leemos las coordenadas más actuales
      const originalCoords = window.__acCoordinates?.[data.parentRelationId];

      if (originalCoords && originalCoords.acX !== undefined && originalCoords.acY !== undefined) {
        // Usar las coordenadas EXACTAS del edge original (máxima precisión)
        [finalPath, finalLabelX, finalLabelY] = getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX: originalCoords.acX,
          targetY: originalCoords.acY,
          targetPosition: Position.Top,
          borderRadius: 5,
          offset: 10
        });


      } else {
        // Fallback: coordenadas estáticas
        if (data?.acTargetX && data?.acTargetY) {
          [finalPath, finalLabelX, finalLabelY] = getSmoothStepPath({
            sourceX,
            sourceY,
            sourcePosition,
            targetX: data.acTargetX,
            targetY: data.acTargetY,
            targetPosition: Position.Top,
            borderRadius: 5,
            offset: 10
          });


        }
      }
    }

    const associationStyle = {
      ...style,
      stroke: '#dc2626',
      strokeWidth: 2,
      strokeDasharray: '8,4',
      pointerEvents: 'none',
      opacity: 1,
      zIndex: 1000
    };

    return (
      <>
        <BaseEdge
          id={id}
          path={finalPath}
          style={associationStyle}
          markerEnd="none"
          markerStart="none"
        />
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              background: '#dc2626',
              color: 'white',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 'bold',
              transform: `translate(-50%, -50%) translate(${finalLabelX}px,${finalLabelY}px)`,
              pointerEvents: 'none',
              zIndex: 1001
            }}
          >
            AC-LINK
          </div>
        </EdgeLabelRenderer>
      </>
    );
  }

  // Estilos especiales para conexiones de notas
  if (isNoteConnection) {
    const noteStyle = {
      ...style,
      stroke: '#fbbf24', // Amarillo para conexiones de notas
      strokeWidth: 1.5,
      strokeDasharray: '4,4', // Línea punteada ligera
      pointerEvents: 'none',
      opacity: 0.8
    };

    return (
      <>
        <BaseEdge
          id={id}
          path={edgePath}
          style={noteStyle}
          markerEnd="none"
          markerStart="none"
        />
      </>
    );
  }

  // Estilos mejorados con feedback visual para relaciones normales
  const edgeStyle = {
    ...style,
    stroke: isSelected ? '#dc2626' : edgeType.stroke, // Rojo cuando está seleccionado
    strokeWidth: isSelected ? 3 : 2, // Más grueso cuando está seleccionado
    strokeDasharray: edgeType.strokeStyle === 'dashed' ? '5,5' : 'none',
    cursor: 'pointer',
    filter: isSelected
      ? 'drop-shadow(0 2px 6px rgb(220 38 38 / 0.4))'
      : 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.1))'
  };

  // Estilos para el área de click invisible
  const clickAreaStyle = {
    stroke: 'transparent',
    strokeWidth: 12, // Área grande para facilitar el click
    fill: 'none',
    cursor: 'pointer'
  };

  const posicionInicio = getCardinalityPosition(sx, sy, sPos, 'start');
  const posicionFin = getCardinalityPosition(tx, ty, tPos, 'end');

  return (
    <>
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 12 12"
          markerWidth="12"
          markerHeight="12"
          orient="auto-start-reverse"
          refX="10"
          refY="6"
        >
          <path d="M 0 0 L 12 6 L 0 12 z" fill="currentColor" />
        </marker>

        <marker
          id="generalization"
          viewBox="0 0 12 12"
          markerWidth="12"
          markerHeight="12"
          orient="auto-start-reverse"
          refX="11"
          refY="6"
        >
          <path d="M 0 0 L 12 6 L 0 12 L 0 0" fill="white" stroke="currentColor" />
        </marker>

        <marker
          id="diamond"
          viewBox="0 0 12 12"
          markerWidth="12"
          markerHeight="12"
          orient="auto-start-reverse"
          refX="11"
          refY="6"
        >
          <path d="M 0 6 L 6 0 L 12 6 L 6 12 z" fill="white" stroke="currentColor" />
        </marker>

        <marker
          id="diamond-filled"
          viewBox="0 0 12 12"
          markerWidth="12"
          markerHeight="12"
          orient="auto-start-reverse"
          refX="11"
          refY="6"
        >
          <path d="M 0 6 L 6 0 L 12 6 L 6 12 z" fill="currentColor" />
        </marker>
      </defs>

      {/* Área invisible para facilitar el click */}
      <path
        d={edgePath}
        style={clickAreaStyle}
        className="react-flow__edge-interaction"
      />

      {/* Edge visual principal */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={edgeStyle}
        markerEnd={edgeType.markerEnd ? `url(#${edgeType.markerEnd})` : undefined}
        markerStart={edgeType.markerStart ? `url(#${edgeType.markerStart})` : undefined}
      />

      {/* Indicador de clase de asociación */}
      {data?.hasAssociationClass && (
        <>
          <circle
            cx={labelX}
            cy={labelY}
            r="4"
            fill="#3b82f6"
            stroke="white"
            strokeWidth="2"
            style={{ filter: 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.3))' }}
          />
          <text
            x={labelX}
            y={labelY - 12}
            textAnchor="middle"
            fontSize="10"
            fontWeight="bold"
            fill="#3b82f6"
            style={{ filter: 'drop-shadow(0 1px 1px rgb(255 255 255 / 0.8))' }}
          >
            AC
          </text>
        </>
      )}

      <EdgeLabelRenderer>
        {/* Nombre de la relación, sobre el tramo central de su carril */}
        {data?.label && (
          <div
            style={{
              position: 'absolute',
              background: 'white',
              padding: '4px 8px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 500,
              border: '1px solid rgba(0,0,0,0.1)',
              whiteSpace: 'nowrap',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY - (enCarril ? 0 : 20)}px)`
            }}
            className="nodrag nopan"
          >
            {data.label}
          </div>
        )}

        {/* Indicador visual para clase de asociación */}
        {data?.hasAssociationClass && (
          <div
            style={{
              position: 'absolute',
              background: '#3b82f6',
              color: 'white',
              padding: '1px 4px',
              borderRadius: '6px',
              fontSize: '10px',
              fontWeight: 'bold',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY + 15}px)`
            }}
            className="nodrag nopan"
            title="Esta relación tiene una clase de asociación"
          >
            AC
          </div>
        )}

        {/* Cardinalidad inicio */}
        {data?.startLabel && (
          <div
            style={{
              position: 'absolute',
              background: 'rgba(255, 255, 255, 0.95)',
              padding: '3px 6px',
              borderRadius: '6px',
              fontSize: '11px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              border: '2px solid #3b82f6',
              color: '#1e40af',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              transform: `translate(-50%, -50%) translate(${posicionInicio.x}px,${posicionInicio.y}px)`,
              zIndex: 1000
            }}
            className="nodrag nopan"
            title={`Cardinalidad inicio: ${data.startLabel}`}
          >
            {data.startLabel}
          </div>
        )}

        {/* Cardinalidad final */}
        {data?.endLabel && (
          <div
            style={{
              position: 'absolute',
              background: 'rgba(255, 255, 255, 0.95)',
              padding: '3px 6px',
              borderRadius: '6px',
              fontSize: '11px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              border: '2px solid #10b981',
              color: '#059669',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              transform: `translate(-50%, -50%) translate(${posicionFin.x}px,${posicionFin.y}px)`,
              zIndex: 1000
            }}
            className="nodrag nopan"
            title={`Cardinalidad final: ${data.endLabel}`}
          >
            {data.endLabel}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
};

export default memo(UmlEdge);
