// A plain label on features that are built and tested in software but have not been run on the real device yet
// (phones, VR headsets, gamepads): "Hardware verification pending". Removed once someone has checked it on the device.
import React from 'react';

export function HardwarePending({ device, what }: { device: string; what?: string }) {
  return (
    <div className="hw-pending" style={{ fontSize: 12, padding: '4px 8px', margin: '4px 0', borderRadius: 6, border: '1px solid rgba(255,190,80,.45)', background: 'rgba(255,190,80,.08)', color: '#f3c77a' }}
      title="Built and tested in software (automated tests, desktop preview), but not yet run on the real device.">
      <b>Hardware verification pending.</b> {what ? what + '. ' : ''}Not yet run on a real {device}.
    </div>
  );
}
