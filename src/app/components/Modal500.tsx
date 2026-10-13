import React, { ReactNode } from 'react';
import FocusTrap from 'focus-trap-react';
import { Modal, Overlay, OverlayBackdrop, OverlayCenter } from 'folds';
import { stopPropagation } from '../utils/keyboard';
import { useBackButtonClose } from '../hooks/useBackButtonClose';

type Modal500Props = {
  requestClose: () => void;
  children: ReactNode;
};
export function Modal500({ requestClose, children }: Modal500Props) {
  useBackButtonClose(true, requestClose);

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter
        style={{
          padding: 'var(--sat) var(--sar) var(--sab) var(--sal)',
          height: 'var(--app-height, 100%)',
        }}
      >
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            clickOutsideDeactivates: true,
            onDeactivate: requestClose,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Modal size="500" variant="Background">
            {children}
          </Modal>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
