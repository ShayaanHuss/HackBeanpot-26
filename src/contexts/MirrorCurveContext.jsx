import React, { createContext, useContext, useState, useRef } from 'react';

const MirrorCurveContext = createContext(null);

export function MirrorCurveProvider({ children }) {
  const [points, setPoints] = useState([]);
  const nextIdRef = useRef(0);

  const value = {
    points,
    setPoints,
    nextIdRef
  };

  return (
    <MirrorCurveContext.Provider value={value}>
      {children}
    </MirrorCurveContext.Provider>
  );
}

export function useMirrorCurve() {
  const context = useContext(MirrorCurveContext);
  if (!context) {
    throw new Error('useMirrorCurve must be used within a MirrorCurveProvider');
  }
  return context;
}
