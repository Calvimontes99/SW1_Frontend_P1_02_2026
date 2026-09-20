import React from 'react';
import CustomModal from '../CustomModal';
import { QRCodeCanvas } from "qrcode.react";

const BoardModals = ({
 modalStates,
 modalActions,
 description,
 setDescription,
 inviteEmail,
 setInviteEmail,
 handleSubmit,
 handleEditSubmit,
 handleInviteUser,
 handleCopyLink,
 currentBoardId
}) => {
 const { modalIsOpen, editModalIsOpen, inviteModalIsOpen } = modalStates;
 const { closeModal, closeEditModal, closeInviteModal } = modalActions;

 return (
   <>
     {/* Modal Crear Nuevo Tablero */}
     <CustomModal
       isOpen={modalIsOpen}
       onClose={closeModal}
       title="Crear Nuevo Tablero"
     >
       <form onSubmit={handleSubmit} className="space-y-6">
         <div>
           <label className="block text-sm font-semibold text-gray-700 mb-2">
             Nombre del Tablero
           </label>
           <input
             type="text"
             value={description}
             onChange={(e) => setDescription(e.target.value)}
             className="input-modern"
             placeholder="Ingrese el nombre del tablero"
             required
           />
         </div>
         <div className="flex justify-end gap-3">
           <button
             type="button"
             onClick={closeModal}
             className="btn-secondary"
           >
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
             </svg>
             Cancelar
           </button>
           <button
             type="submit"
             className="btn-primary"
           >
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
             </svg>
             Crear Tablero
           </button>
         </div>
       </form>
     </CustomModal>

     {/* Modal Editar Tablero */}
     <CustomModal
       isOpen={editModalIsOpen}
       onClose={closeEditModal}
       title="Editar Tablero"
     >
       <form onSubmit={handleEditSubmit} className="space-y-6">
         <div>
           <label className="block text-sm font-semibold text-gray-700 mb-2">
             Nombre del Tablero
           </label>
           <input
             type="text"
             value={description}
             onChange={(e) => setDescription(e.target.value)}
             className="input-modern"
             placeholder="Ingrese el nuevo nombre del tablero"
             required
           />
         </div>
         <div className="flex justify-end gap-3">
           <button
             type="button"
             onClick={closeEditModal}
             className="btn-secondary"
           >
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
             </svg>
             Cancelar
           </button>
           <button
             type="submit"
             className="btn-primary"
           >
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
             </svg>
             Guardar Cambios
           </button>
         </div>
       </form>
     </CustomModal>

     {/* Modal Invitar Usuarios */}
     <CustomModal
       isOpen={inviteModalIsOpen}
       onClose={closeInviteModal}
       title="Invitar Usuarios"
     >
       <div className="space-y-6">
         <div className="flex flex-col items-center">
           {/* QR Code */}
           <div className="bg-white p-4 rounded-xl shadow-md mb-4">
             <QRCodeCanvas
               value={`${window.location.origin}/board/${currentBoardId}`}
               size={256}
               className="rounded-lg"
             />
           </div>
           
           <p className="text-sm text-gray-600 mb-4 text-center font-medium">
             Comparte este código QR o usa el enlace para invitar a otros usuarios
           </p>
           
           {/* Botón Copiar Enlace */}
           <button
             onClick={() => handleCopyLink(currentBoardId)}
             className="btn-primary w-full"
           >
             <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
             </svg>
             Copiar Enlace
           </button>

           <div className="w-full border-t border-gray-200 my-6"></div>

           {/* Invitación por Email */}
           <div className="w-full">
             <label className="block text-sm font-semibold text-gray-700 mb-2">
               Invitar por correo electrónico
             </label>
             <div className="flex gap-2">
               <input
                 type="email"
                 placeholder="correo@ejemplo.com"
                 className="input-modern flex-1"
                 value={inviteEmail}
                 onChange={(e) => setInviteEmail(e.target.value)}
               />
               <button
                 onClick={() => {
                   handleInviteUser(inviteEmail);
                   setInviteEmail("");
                 }}
                 className="btn-success whitespace-nowrap"
               >
                 <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                 </svg>
                 Invitar
               </button>
             </div>
           </div>
         </div>
       </div>
     </CustomModal>
   </>
 );
};

export default BoardModals;