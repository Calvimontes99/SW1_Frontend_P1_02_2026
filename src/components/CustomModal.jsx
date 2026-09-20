// CustomModal.jsx corregido
import React from 'react';
import Modal from 'react-modal';
import PropTypes from 'prop-types';
import '../../src/index.css';

Modal.setAppElement('#root');

// Usar parámetros por defecto en vez de defaultProps
const CustomModal = ({ 
  isOpen, 
  onClose, 
  title, 
  children,
  size = 'medium' // Parámetro por defecto en JavaScript
}) => {
  const sizeClasses = {
    small: 'max-w-sm',
    medium: 'max-w-md',
    large: 'max-w-lg'
  };

  const customStyles = {
    overlay: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem'
    },
    content: {
      position: 'relative',
      top: 'auto',
      left: 'auto',
      right: 'auto',
      bottom: 'auto',
      padding: 0,
      border: 'none',
      background: 'none',
      overflow: 'visible'
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onRequestClose={onClose}
      style={customStyles}
      contentLabel={title}
    >
      <div className={`${sizeClasses[size]} w-full bg-white rounded-lg shadow-xl`}>
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-800">{title}</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors focus:outline-none"
              aria-label="Cerrar"
            >
              <svg 
                className="w-6 h-6" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth="2" 
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
        <div className="px-6 py-4">
          {children}
        </div>
      </div>
    </Modal>
  );
};

CustomModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string.isRequired,
  children: PropTypes.node.isRequired,
  size: PropTypes.oneOf(['small', 'medium', 'large'])
};

// Eliminar defaultProps y usar el parámetro por defecto arriba
export default React.memo(CustomModal);