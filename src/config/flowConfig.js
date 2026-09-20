
// src/config/flowConfig.js
import ClassNode from '../components/tablas/ClassNode';
import NoteNode from '../components/tablas/NoteNode';
import UmlEdge from '../components/UmlEdge';

export const nodeTypes = {
  classNode: ClassNode,
  noteNode: NoteNode
};

export const edgeTypes = {
  umlEdge: UmlEdge
};

export const defaultEdgeOptions = {
  type: 'umlEdge',
  animated: false,
  style: {
    strokeWidth: 1.5,
    stroke: '#333'
  }
};