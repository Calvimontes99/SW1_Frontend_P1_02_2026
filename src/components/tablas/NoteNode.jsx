// NoteNode.jsx - Componente para notas/anotaciones UML
import React from 'react';
import { Handle, Position } from '@xyflow/react';

function NoteNode({ data, isConnectable, selected }) {
  const noteText = data?.text || 'Nueva nota...';
  
  return (
    <div 
      className={`note-node ${selected ? 'selected' : ''}`}
      style={{
        background: '#fffacd', // Color amarillo claro típico de notas
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '12px',
        minWidth: '120px',
        maxWidth: '250px',
        position: 'relative',
        boxShadow: selected 
          ? '0 4px 12px rgba(255, 193, 7, 0.4)' 
          : '0 2px 6px rgba(0, 0, 0, 0.1)',
        fontSize: '12px',
        fontFamily: 'Arial, sans-serif',
        color: '#333',
        lineHeight: '1.4',
        transition: 'all 0.2s ease',
        wordWrap: 'break-word',
        whiteSpace: 'pre-wrap'
      }}
    >
      {/* Esquina doblada característica de las notas UML */}
      <div 
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '15px',
          height: '15px',
          background: '#f0e68c',
          clipPath: 'polygon(0% 0%, 100% 100%, 0% 100%)',
          border: '1px solid #ddd',
          borderLeft: 'none',
          borderBottom: 'none'
        }}
      />
      
      {/* Línea de separación de la esquina doblada */}
      <div 
        style={{
          position: 'absolute',
          top: '15px',
          right: 0,
          width: '1px',
          height: '15px',
          background: '#ddd',
          transform: 'rotate(45deg)',
          transformOrigin: 'bottom'
        }}
      />
      
      {/* Contenido de la nota */}
      <div style={{ 
        paddingRight: '20px', // Espacio para la esquina doblada
        minHeight: '20px'
      }}>
        {noteText}
      </div>
      
      {/* Handle para conectar la nota a otros elementos */}
      <Handle
        type="source"
        position={Position.Top}
        id="note-connector"
        isConnectable={isConnectable}
        style={{
          background: '#ffc107',
          border: '2px solid #fff',
          width: '8px',
          height: '8px',
          top: '-4px',
          opacity: selected ? 1 : 0.3
        }}
      />
      
      <Handle
        type="source"
        position={Position.Right}
        id="note-connector-right"
        isConnectable={isConnectable}
        style={{
          background: '#ffc107',
          border: '2px solid #fff',
          width: '8px',
          height: '8px',
          right: '-4px',
          opacity: selected ? 1 : 0.3
        }}
      />
      
      <Handle
        type="source"
        position={Position.Bottom}
        id="note-connector-bottom"
        isConnectable={isConnectable}
        style={{
          background: '#ffc107',
          border: '2px solid #fff',
          width: '8px',
          height: '8px',
          bottom: '-4px',
          opacity: selected ? 1 : 0.3
        }}
      />
      
      <Handle
        type="source"
        position={Position.Left}
        id="note-connector-left"
        isConnectable={isConnectable}
        style={{
          background: '#ffc107',
          border: '2px solid #fff',
          width: '8px',
          height: '8px',
          left: '-4px',
          opacity: selected ? 1 : 0.3
        }}
      />
    </div>
  );
}

export default NoteNode;