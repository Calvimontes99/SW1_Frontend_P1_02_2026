import React from 'react';
import { getSmoothStepPath } from '@xyflow/react';

const AssociationLines = ({ nodes, edges, transform }) => {
  // Filtrar edges que tienen clase de asociación
  const edgesWithAssociation = edges.filter(edge => edge.data?.hasAssociationClass);

  if (edgesWithAssociation.length === 0) return null;

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1000
      }}
    >
      {edgesWithAssociation.map(edge => {
        // Encontrar nodos source y target
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);
        const associationNode = nodes.find(n => n.id === edge.data.associationClassNodeId);

        if (!sourceNode || !targetNode || !associationNode) return null;

        // Calcular punto medio de la relación original
        const sourceX = sourceNode.position.x + 170; // Ancho aproximado del nodo
        const sourceY = sourceNode.position.y + 90;  // Alto aproximado del nodo / 2
        const targetX = targetNode.position.x;
        const targetY = targetNode.position.y + 90;

        const midX = (sourceX + targetX) / 2;
        const midY = (sourceY + targetY) / 2;

        // Posición del centro de la clase de asociación
        const assocX = associationNode.position.x + 85; // Centro de la clase
        const assocY = associationNode.position.y + 180; // Parte inferior de la clase

        // Aplicar transformación (zoom y pan)
        const scaledMidX = midX * transform[2] + transform[0];
        const scaledMidY = midY * transform[2] + transform[1];
        const scaledAssocX = assocX * transform[2] + transform[0];
        const scaledAssocY = assocY * transform[2] + transform[1];

        return (
          <line
            key={`assoc-line-${edge.id}`}
            x1={scaledAssocX}
            y1={scaledAssocY}
            x2={scaledMidX}
            y2={scaledMidY}
            stroke="#666"
            strokeWidth={1.5}
            strokeDasharray="5,5"
            opacity={0.7}
          />
        );
      })}
    </svg>
  );
};

export default AssociationLines;